import { describe, expect, it } from "vitest";
import { groupProjects } from "../src/services/grouping-service";
import { DEFAULT_SETTINGS, ProjectItem, ProjectMasterSettings } from "../src/types";

function item(overrides: Partial<ProjectItem> & { name: string; path?: string }): ProjectItem {
	const path = overrides.path ?? `100 Projects/${overrides.name}.md`;
	const segments = path.split("/");
	return {
		status: "active",
		startDate: null,
		dueDate: null,
		completionDate: null,
		progress: null,
		priority: null,
		area: [],
		objective: null,
		context: null,
		longTerm: false,
		mainProject: false,
		projectId: null,
		projectLeader: null,
		projectMembers: [],
		tags: [],
		file: {
			path,
			name: overrides.name,
			folder: segments.slice(0, -1).join("/"),
		},
		...overrides,
	};
}

type FolderNotes = Record<string, { path: string; name: string }[]>;

describe("快速项目分区（F3.1，继承 projectOverview.js 分区规则）", () => {
	it("root-level projects of a scan folder land in the quick section", () => {
		const result = groupProjects(
			[item({ name: "quick1", path: "100 Projects/quick1.md" })],
			DEFAULT_SETTINGS,
		);
		expect(result.quickGroups).toHaveLength(1);
		expect(result.quickGroups[0]?.title).toContain("根目录");
		expect(result.quickGroups[0]?.projects).toHaveLength(1);
		expect(result.normalGroups).toHaveLength(0);
	});

	it("folders containing the marker segment become titled quick groups", () => {
		const result = groupProjects(
			[
				item({ name: "q", path: "100 Projects/市场部/快速项目/q.md" }),
			],
			DEFAULT_SETTINGS,
		);
		expect(result.quickGroups).toHaveLength(1);
		// 分区标题 = 去掉扫描前缀后的路径层级，/ → " > "
		expect(result.quickGroups[0]?.title).toBe("市场部 > 快速项目");
	});

	it("marker matches by segment, not substring", () => {
		const result = groupProjects(
			[item({ name: "x", path: "100 Projects/非快速项目集/x.md" })],
			DEFAULT_SETTINGS,
		);
		// 「非快速项目集」整段不等于标记「快速项目」，不算快速分区
		expect(result.quickGroups).toHaveLength(0);
		expect(result.normalGroups).toHaveLength(1);
	});

	it("quick groups are sorted by path", () => {
		const result = groupProjects(
			[
				item({ name: "b", path: "100 Projects/市场部/快速项目/b.md" }),
				item({ name: "a", path: "100 Projects/行政部/快速项目/a.md" }),
			],
			DEFAULT_SETTINGS,
		);
		// 码点序：市 U+5E02 < 行 U+884C → 市场部在前。
		// 与 ref/projectOverview.js 的 localeCompare 路径排序结果一致，且跨 ICU 环境确定。
		expect(result.quickGroups.map((g) => g.title)).toEqual([
			"市场部 > 快速项目",
			"行政部 > 快速项目",
		]);
	});
});

describe("正常项目分区（F3.2，main-project 代表逻辑）", () => {
	it("groups normal projects by folder", () => {
		const result = groupProjects(
			[
				item({ name: "a", path: "100 Projects/官网/a.md" }),
				item({ name: "b", path: "100 Projects/官网/b.md" }),
				item({ name: "c", path: "100 Projects/市场/c.md" }),
			],
			DEFAULT_SETTINGS,
		);
		expect(result.normalGroups).toHaveLength(2);
		const guanwang = result.normalGroups.find((g) => g.key === "100 Projects/官网");
		expect(guanwang?.projects).toHaveLength(2);
		expect(guanwang?.representative?.file.name).toBe("a");
	});

	it("uses main-project: true as the representative when present", () => {
		const result = groupProjects(
			[
				item({ name: "sub", path: "100 Projects/官网/sub.md" }),
				item({ name: "main", path: "100 Projects/官网/main.md", mainProject: true }),
			],
			DEFAULT_SETTINGS,
		);
		const group = result.normalGroups.find((g) => g.key === "100 Projects/官网");
		expect(group?.representative?.file.name).toBe("main");
		expect(group?.warning).toBeUndefined();
	});

	it("warns when a folder has multiple projects but no main-project flag", () => {
		const result = groupProjects(
			[
				item({ name: "p1", path: "100 Projects/官网/p1.md" }),
				item({ name: "p2", path: "100 Projects/官网/p2.md" }),
			],
			DEFAULT_SETTINGS,
		);
		const group = result.normalGroups.find((g) => g.key === "100 Projects/官网");
		expect(group?.warning).toBe("multiple-projects");
	});

	it("single project folder has no warning", () => {
		const result = groupProjects(
			[item({ name: "solo", path: "100 Projects/官网/solo.md" })],
			DEFAULT_SETTINGS,
		);
		expect(result.normalGroups[0]?.warning).toBeUndefined();
	});

	it("groups are sorted by representative due date descending (script behavior), dateless last, then key", () => {
		const result = groupProjects(
			[
				item({ name: "older", path: "100 Projects/A/older.md", dueDate: "2026-01-01" }),
				item({ name: "newer", path: "100 Projects/B/newer.md", dueDate: "2026-12-01" }),
				item({ name: "none", path: "100 Projects/C/none.md" }),
				item({ name: "zz", path: "100 Projects/D/zz.md" }),
			],
			DEFAULT_SETTINGS,
		);
		expect(result.normalGroups.map((g) => g.key)).toEqual([
			"100 Projects/B",
			"100 Projects/A",
			"100 Projects/C",
			"100 Projects/D",
		]);
	});
});

describe("分组模式（F4.1 / SPEC §5.4 defaultGrouping）", () => {
	const settings: ProjectMasterSettings = {
		...DEFAULT_SETTINGS,
		defaultGrouping: "objective",
	};

	it("objective mode groups by objective with fallback bucket", () => {
		const result = groupProjects(
			[
				item({ name: "a", objective: "官网改版" }),
				item({ name: "b", objective: "官网改版" }),
				item({ name: "c", objective: null }),
			],
			settings,
		);
		expect(result.normalGroups.map((g) => g.key)).toEqual(["官网改版", "（未设置）"]);
		expect(result.normalGroups[0]?.projects).toHaveLength(2);
	});
});

describe("组内笔记列表（F3.3，继承 maxNotes 行为）", () => {
	it("lists folder notes excluding the representative, truncated with remaining count", () => {
		const folderNotes: FolderNotes = {
			"100 Projects/官网": [
				{ path: "100 Projects/官网/main.md", name: "main" },
				{ path: "100 Projects/官网/note1.md", name: "note1" },
				{ path: "100 Projects/官网/note2.md", name: "note2" },
				{ path: "100 Projects/官网/note3.md", name: "note3" },
			],
		};
		const result = groupProjects(
			[item({ name: "main", path: "100 Projects/官网/main.md", mainProject: true })],
			{ ...DEFAULT_SETTINGS, maxNotesPerProject: 2 },
			{ folderNotes },
		);
		const group = result.normalGroups[0];
		expect(group?.notes?.shown.map((n) => n.name)).toEqual(["note1", "note2"]);
		expect(group?.notes?.remaining).toBe(1);
	});

	it("folder without notes shows empty list", () => {
		const result = groupProjects(
			[item({ name: "solo", path: "100 Projects/官网/solo.md" })],
			DEFAULT_SETTINGS,
			{ folderNotes: {} },
		);
		const group = result.normalGroups[0];
		expect(group?.notes?.shown).toEqual([]);
		expect(group?.notes?.remaining).toBe(0);
	});
});
