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

type VaultLayout = { path: string; frontmatter: Record<string, unknown> | null }[];

/** 模拟一个真实 vault 的文件布局（项目文件夹 + 资料子文件夹） */
const VAULT: VaultLayout = [
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

function buildIndex(vault: VaultLayout = VAULT) {
	const files = vault.map(({ path }) => {
		const segments = path.split("/");
		return {
			path,
			name: (segments[segments.length - 1] ?? "").replace(/\.md$/, ""),
			folder: segments.slice(0, -1).join("/"),
		};
	});
	const caches: Record<string, Record<string, unknown> | null> = {};
	for (const entry of vault) caches[entry.path] = entry.frontmatter;

	const index = new ProjectIndex(files, (path) => caches[path] ?? null, DEFAULT_SETTINGS);
	index.rebuild();
	return index;
}

/** 文件夹 → 该文件夹下的全部笔记（含非项目笔记），与 main.ts 的 getFolderNotes() 同构 */
function folderNotesFromVault(vault: VaultLayout = VAULT): Record<string, { path: string; name: string }[]> {
	const map: Record<string, { path: string; name: string }[]> = {};
	for (const { path } of vault) {
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

/*
 * 用户报的 bug（2026-09-20）：
 * 「有些项目，还没有资料的时候是一个单独的项目笔记，这个笔记所在的目录里有很多
 *   其他项目文件夹，其他项目文件夹都被认定为该项目的资料了。」
 *
 * 典型布局：中间层目录 `100 Projects/2026工作项目/` 里既有孤零零的项目笔记，
 * 又放着好几个项目文件夹。只按「递归该目录」收集，兄弟项目的资料会全部算到
 * 那封笔记头上——明明是 0 条资料的项目，卡片上却冒出十几条。
 *
 * 口径：**直接放着项目文档的文件夹 = 那个项目的地盘**，别人的地盘整棵剪掉。
 */
describe("资料归集：别人的地盘不算我的资料（用户口径 2026-09-20）", () => {
	const project = (
		start: string,
		due: string,
	): Record<string, unknown> => ({
		type: "project",
		status: "active",
		start_date: start,
		due_date: due,
	});

	const LAYOUT: VaultLayout = [
		// ① 还没资料的项目：项目笔记直接躺在中间层目录里
		{
			path: "100 Projects/2026工作项目/转泰国.md",
			frontmatter: project("2026-03-01", "2026-04-01"),
		},
		// ② 兄弟项目 A：自己的文件夹 + 同层资料（按用户口径，带资料的项目文件夹没有子文件夹）
		{
			path: "100 Projects/2026工作项目/CIMSOne/CIMSOne.md",
			frontmatter: project("2026-01-01", "2027-02-28"),
		},
		{ path: "100 Projects/2026工作项目/CIMSOne/会议记录.md", frontmatter: null },
		{ path: "100 Projects/2026工作项目/CIMSOne/需求梳理.md", frontmatter: null },
		// 非项目子文件夹：不在别人的地盘里，仍然要收（防止「一刀切不递归」的过度修正）
		{ path: "100 Projects/2026工作项目/CIMSOne/附件/现场图.md", frontmatter: null },
		// ③ 兄弟项目 B/C：位于「快速项目」分区目录下
		{
			path: "100 Projects/2026工作项目/快速项目/秋季Outing.md",
			frontmatter: project("2026-09-01", "2026-11-30"),
		},
		{
			path: "100 Projects/2026工作项目/快速项目/年会筹备.md",
			frontmatter: project("2026-12-01", "2027-01-30"),
		},
	];

	function groupsOf() {
		const index = buildIndex(LAYOUT);
		const projects = index.getAll();
		return groupProjects(projects, DEFAULT_SETTINGS, {
			folderNotes: folderNotesFromVault(LAYOUT),
			projectPaths: projects.map((p) => p.file.path),
		});
	}

	it("gives the standalone project in a mid-level folder zero materials", () => {
		const result = groupsOf();
		// 修复前这里会是 3（CIMSOne 的两条同层资料 + 附件里的那条）
		expect(result.materialsByPath["100 Projects/2026工作项目/转泰国.md"]).toEqual([]);
	});

	it("does not let sibling projects leak into the mid-level folder's group card", () => {
		const result = groupsOf();
		const midLevel = result.normalGroups.find((g) => g.key === "100 Projects/2026工作项目");
		expect(midLevel?.notes?.total).toBe(0);
		expect(midLevel?.projects.map((p) => p.file.name)).toEqual(["转泰国"]);
	});

	it("still counts the sibling project's own materials, subfolders included", () => {
		const result = groupsOf();
		// 路径码点序：会 U+4F1A < 附 U+9644 < 需 U+9700
		expect(
			result.materialsByPath["100 Projects/2026工作项目/CIMSOne/CIMSOne.md"]?.map((n) => n.name),
		).toEqual(["会议记录", "现场图", "需求梳理"]);
	});

	it("leaves the quick section untouched (quick projects have no folder of their own)", () => {
		const result = groupsOf();
		const quick = result.quickGroups.find(
			(g) => g.folder === "100 Projects/2026工作项目/快速项目",
		);
		expect(quick?.projects.map((p) => p.file.name)).toEqual(["秋季Outing", "年会筹备"]);
		expect(result.materialsByPath["100 Projects/2026工作项目/快速项目/秋季Outing.md"]).toEqual(
			[],
		);
	});

	it("counts a subfolder as another project's turf as soon as it holds a project note at any depth", () => {
		const vault: VaultLayout = [
			{
				path: "100 Projects/A/A.md",
				frontmatter: project("2026-01-01", "2026-06-30"),
			},
			{ path: "100 Projects/A/资料/平常笔记.md", frontmatter: null },
			// 资料/ 深处藏着一个归档项目 → 整个「资料/」都不再算 A 的资料
			{
				path: "100 Projects/A/资料/归档/旧项目.md",
				frontmatter: project("2025-01-01", "2025-02-01"),
			},
			{ path: "100 Projects/A/资料/归档/旧项目笔记.md", frontmatter: null },
		];
		const index = buildIndex(vault);
		const projects = index.getAll();
		const result = groupProjects(projects, DEFAULT_SETTINGS, {
			folderNotes: folderNotesFromVault(vault),
			projectPaths: projects.map((p) => p.file.path),
		});

		// 子文件夹里只要住着另一个项目文档，它就不算「没人认领的资料」
		expect(result.materialsByPath["100 Projects/A/A.md"]).toEqual([]);
		// 而那个归档项目自己的资料照常归它
		expect(
			result.materialsByPath["100 Projects/A/资料/归档/旧项目.md"]?.map((n) => n.name),
		).toEqual(["旧项目笔记"]);
	});

	it("blocks other projects' folders even when the sibling is nested inside the folder", () => {
		// ④ 子项目：项目文件夹里还嵌着另一个项目文件夹——它同样不是资料
		const nested: VaultLayout = [
			{
				path: "100 Projects/总项目/总项目.md",
				frontmatter: project("2026-01-01", "2026-06-30"),
			},
			{ path: "100 Projects/总项目/总项目笔记.md", frontmatter: null },
			{
				path: "100 Projects/总项目/子项目/子项目.md",
				frontmatter: project("2026-02-01", "2026-03-31"),
			},
			{ path: "100 Projects/总项目/子项目/子项目笔记.md", frontmatter: null },
		];
		const index = buildIndex(nested);
		const projects = index.getAll();
		const result = groupProjects(projects, DEFAULT_SETTINGS, {
			folderNotes: folderNotesFromVault(nested),
			projectPaths: projects.map((p) => p.file.path),
		});

		// 总项目只拿到自己同层的那条，子项目文件夹整棵被剪掉
		expect(result.materialsByPath["100 Projects/总项目/总项目.md"]?.map((n) => n.name)).toEqual([
			"总项目笔记",
		]);
		// 子项目自己的资料照常归它
		expect(
			result.materialsByPath["100 Projects/总项目/子项目/子项目.md"]?.map((n) => n.name),
		).toEqual(["子项目笔记"]);
	});
});

/*
 * 用户口径 2026-09-20：资料子文件夹名允许留空 = 资料与项目文档放在同一个文件夹里
 * （用户的迁移脚本就是这么放的）。
 *
 * 留空只影响「新建项目时建不建那个子文件夹」，**不影响资料归集**——
 * 归集口径是「项目文件夹本身 + 它的子文件夹」，与这个参数无关。
 * 这条测试固定住它，免得以后有人把「留空」实现成「不统计同层笔记」。
 */
describe("资料子文件夹名留空：同层资料照样算（用户口径 2026-09-20）", () => {
	const project: Record<string, unknown> = {
		type: "project",
		status: "active",
		start_date: "2026-01-01",
		due_date: "2026-06-30",
	};
	const LAYOUT: VaultLayout = [
		{ path: "100 Projects/A/A.md", frontmatter: project },
		{ path: "100 Projects/A/会议记录.md", frontmatter: null },
		{ path: "100 Projects/A/需求梳理.md", frontmatter: null },
		{ path: "100 Projects/A/附件/现场图.md", frontmatter: null },
	];

	it("counts notes next to the project document, subfolders included", () => {
		const index = buildIndex(LAYOUT);
		const projects = index.getAll();
		const result = groupProjects(
			projects,
			{ ...DEFAULT_SETTINGS, materialsFolderName: "" },
			{
				folderNotes: folderNotesFromVault(LAYOUT),
				projectPaths: projects.map((p) => p.file.path),
			},
		);
		// 路径码点序：会 U+4F1A < 附 U+9644 < 需 U+9700
		expect(result.materialsByPath["100 Projects/A/A.md"]?.map((n) => n.name)).toEqual([
			"会议记录",
			"现场图",
			"需求梳理",
		]);
	});
});

/*
 * 用户口径 2026-09-20：快速项目路径标记也允许留空（空 = 新建的快速项目直接放扫描目录下）。
 *
 * 留空不能把判定搞坏：两处判定都是「路径段 === 标记」，而 `split("/")` 的段永不为空串，
 * 所以空标记只命中「扫描目录根层」那一条分支，中间层目录里的项目仍是普通项目。
 */
describe("快速项目标记留空：只认扫描目录根层（用户口径 2026-09-20）", () => {
	const project: Record<string, unknown> = {
		type: "project",
		status: "active",
		start_date: "2026-01-01",
		due_date: "2026-06-30",
	};
	const LAYOUT: VaultLayout = [
		{ path: "100 Projects/根层项目.md", frontmatter: project },
		{ path: "100 Projects/某个中间层/中层项目.md", frontmatter: project },
	];

	it("keeps only root-level documents in the quick section", () => {
		const index = buildIndex(LAYOUT);
		const projects = index.getAll();
		const result = groupProjects(
			projects,
			{ ...DEFAULT_SETTINGS, quickProjectMarker: "" },
			{
				folderNotes: folderNotesFromVault(LAYOUT),
				projectPaths: projects.map((p) => p.file.path),
			},
		);

		expect(result.quickPaths).toEqual(["100 Projects/根层项目.md"]);
		expect(result.quickGroups.map((g) => g.title)).toEqual(["快速项目（根目录）"]);
		// 中间层那个照常按文件夹成组，没有被空标记误判成快速项目
		expect(result.normalGroups.map((g) => g.key)).toEqual(["100 Projects/某个中间层"]);
	});
});
