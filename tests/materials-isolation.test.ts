import { describe, expect, it } from "vitest";
import { buildGanttModel } from "../src/gantt/gantt-model";
import { groupProjects, toSectionSpecs } from "../src/services/grouping-service";
import { ProjectIndex } from "../src/services/project-index";
import { DEFAULT_SETTINGS } from "../src/types";

/**
 * 端到端守卫（用户口径 2026-09-18）：
 *
 * 一个项目文件夹 = 项目文档 + 其子文件夹里的资料/笔记。这条测试把整条链路串起来
 * （frontmatter → 索引 → 分组 → 甘特模型），固定两条不可回退的约定：
 *   1. 资料/笔记**永远**不会出现在甘特图上；
 *   2. 分组卡片上的数量 = 该项目下的资料/笔记数，不是「文件夹里有几个项目」。
 *
 * 为什么值得单独一个文件：这两条一旦被后续改动破坏，表现是「图上多出莫名其妙的条」
 * 或「计数看着像项目数」，都很难从单模块测试里看出来。
 */

const TODAY = "2026-09-18";

/** 模拟一个真实 vault 的文件布局（项目文件夹 + 资料子文件夹） */
const VAULT: { path: string; frontmatter: Record<string, unknown> | null }[] = [
	// 形态 B：项目文档 + 资料子文件夹
	{
		path: "100 Projects/官网改版/官网改版.md",
		frontmatter: {
			type: "project",
			status: "active",
			start_date: "2026-01-01",
			due_date: "2026-03-01",
			"main-project": true,
			area: ["市场"],
		},
	},
	{ path: "100 Projects/官网改版/资料/需求梳理.md", frontmatter: { tags: ["note"] } },
	{ path: "100 Projects/官网改版/资料/会议记录.md", frontmatter: null },
	{ path: "100 Projects/官网改版/资料/访谈/0901 访谈.md", frontmatter: null },
	// 形态 A：只有项目文档
	{
		path: "100 Projects/内部工具/内部工具.md",
		frontmatter: {
			type: "project",
			status: "active",
			start_date: "2026-02-01",
			due_date: "2026-04-01",
		},
	},
	// 快速项目：扫描目录根层，没有自己的文件夹
	{
		path: "100 Projects/临时调研.md",
		frontmatter: { type: "project", status: "draft", start_date: "2026-05-01" },
	},
];

function buildIndex() {
	const files = VAULT.map(({ path }) => {
		const segments = path.split("/");
		return {
			path,
			name: (segments[segments.length - 1] ?? "").replace(/\.md$/, ""),
			folder: segments.slice(0, -1).join("/"),
		};
	});
	const caches: Record<string, Record<string, unknown> | null> = {};
	for (const entry of VAULT) caches[entry.path] = entry.frontmatter;

	const index = new ProjectIndex(files, (path) => caches[path] ?? null, DEFAULT_SETTINGS);
	index.rebuild();
	return index;
}

/** 文件夹 → 该文件夹下的全部笔记（含非项目笔记），与 main.ts 的 getFolderNotes() 同构 */
function folderNotesFromVault(): Record<string, { path: string; name: string }[]> {
	const map: Record<string, { path: string; name: string }[]> = {};
	for (const { path } of VAULT) {
		const segments = path.split("/");
		const folder = segments.slice(0, -1).join("/");
		const name = (segments[segments.length - 1] ?? "").replace(/\.md$/, "");
		(map[folder] ??= []).push({ path, name });
	}
	return map;
}

describe("资料/笔记不会进入甘特图", () => {
	it("indexes only the three project documents, none of the materials", () => {
		const index = buildIndex();
		const paths = index
			.getAll()
			.map((item) => item.file.path)
			.sort();
		// 码点序：临 U+4E34 < 内 U+5185 < 官 U+5B98
		expect(paths).toEqual([
			"100 Projects/临时调研.md",
			"100 Projects/内部工具/内部工具.md",
			"100 Projects/官网改版/官网改版.md",
		]);
		// 资料一律不在索引里
		expect(paths.some((p) => p.includes("资料/"))).toBe(false);
	});

	it("renders one gantt bar per project document and nothing else", () => {
		const index = buildIndex();
		const projects = index.getAll();
		const groups = groupProjects(projects, DEFAULT_SETTINGS, {
			folderNotes: folderNotesFromVault(),
			projectPaths: projects.map((p) => p.file.path),
		});
		const model = buildGanttModel(
			projects,
			DEFAULT_SETTINGS,
			TODAY,
			{ sections: toSectionSpecs(groups).map((s) => ({ ...s, collapsed: false })) },
		);

		expect(model.rows.map((r) => r.item.file.name).sort()).toEqual([
			"临时调研",
			"内部工具",
			"官网改版",
		].sort());
		expect(model.rows.some((r) => r.item.file.path.includes("资料/"))).toBe(false);
	});

	it("never lets a materials-only folder create a gantt section", () => {
		const index = buildIndex();
		const projects = index.getAll();
		const groups = groupProjects(projects, DEFAULT_SETTINGS, {
			folderNotes: folderNotesFromVault(),
			projectPaths: projects.map((p) => p.file.path),
		});
		const specs = toSectionSpecs(groups);
		expect(specs.some((s) => s.name.includes("资料"))).toBe(false);
		// 资料子文件夹不该单独成一个分组
		expect(specs.map((s) => s.key)).not.toContain("100 Projects/官网改版/资料");
	});
});

describe("分组卡片数量 = 该项目下的资料/笔记数", () => {
	it("counts the project's materials recursively and reports the folder's project count separately", () => {
		const index = buildIndex();
		const projects = index.getAll();
		const groups = groupProjects(projects, DEFAULT_SETTINGS, {
			folderNotes: folderNotesFromVault(),
			projectPaths: projects.map((p) => p.file.path),
		});

		const guanwang = groups.normalGroups.find((g) => g.key === "100 Projects/官网改版");
		expect(guanwang?.notes?.total).toBe(3);
		// 按路径码点序：会 U+4F1A < 访 U+8BBF < 需 U+9700
		expect(guanwang?.notes?.shown.map((n) => n.name)).toEqual([
			"会议记录",
			"0901 访谈",
			"需求梳理",
		]);
		// 这个文件夹只有一个项目文档 → 不该出现「多项目文档」警告
		expect(guanwang?.warning).toBeUndefined();

		const tool = groups.normalGroups.find((g) => g.key === "100 Projects/内部工具");
		expect(tool?.notes?.total).toBe(0);
	});

	it("puts the folder-less project into the quick section instead of a normal group", () => {
		const index = buildIndex();
		const projects = index.getAll();
		const groups = groupProjects(projects, DEFAULT_SETTINGS, {
			folderNotes: folderNotesFromVault(),
			projectPaths: projects.map((p) => p.file.path),
		});
		expect(groups.quickGroups.map((g) => g.title)).toEqual(["快速项目（根目录）"]);
		expect(groups.quickGroups[0]?.projects.map((p) => p.file.name)).toEqual(["临时调研"]);
	});

	it("keeps panel and gantt in lockstep: same sections, same membership", () => {
		const index = buildIndex();
		const projects = index.getAll();
		const groups = groupProjects(projects, DEFAULT_SETTINGS, {
			folderNotes: folderNotesFromVault(),
			projectPaths: projects.map((p) => p.file.path),
		});
		const specs = toSectionSpecs(groups);
		const model = buildGanttModel(
			projects,
			DEFAULT_SETTINGS,
			TODAY,
			{ sections: specs.map((s) => ({ ...s, collapsed: false })) },
		);
		expect(model.sections.map((s) => s.key)).toEqual(specs.map((s) => s.key));
		expect(model.sections.map((s) => s.name)).toEqual(specs.map((s) => s.name));
	});
});
