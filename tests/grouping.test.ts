import { describe, expect, it } from "vitest";
import {
	classifyProject,
	groupProjects,
	isQuickProject,
	splitByKind,
	toSectionSpecs,
} from "../src/services/grouping-service";
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
		color: null,
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

/*
 * 「不分组」档（用户口径 2026-09-20）：不按文件夹 / 目标 / 领域切，
 * 改成按「有没有资料 + 快速项目」分三块，一眼看出哪些项目还空着。
 *
 * 判定复用 `splitByKind()`——面板的卡片形态用的就是它，所以这组用例同时也锁住了
 * 「分区」与「卡片形态」不会各走一套口径。
 */
describe("不分组模式（有资料 / 没资料 / 快速项目三分区）", () => {
	const noneSettings: ProjectMasterSettings = { ...DEFAULT_SETTINGS, defaultGrouping: "none" };
	const folders: FolderNotes = {
		// A 有自己的文件夹且里面有资料；B 的文件夹是空的；quick 在扫描根层
		"100 Projects/A": [{ path: "100 Projects/A/笔记.md", name: "笔记" }],
	};

	it("splits into 快速项目 → 有资料 → 没资料 in that order", () => {
		const result = groupProjects(
			[
				item({ name: "quick", path: "100 Projects/quick.md" }),
				item({ name: "A", path: "100 Projects/A/A.md" }),
				item({ name: "B", path: "100 Projects/B/B.md" }),
			],
			noneSettings,
			{ folderNotes: folders },
		);
		expect(result.quickGroups.map((group) => group.title)).toEqual(["快速项目"]);
		expect(result.normalGroups.map((group) => group.title)).toEqual(["有资料", "没资料"]);
		expect(toSectionSpecs(result).map((spec) => spec.name)).toEqual([
			"快速项目",
			"有资料",
			"没资料",
		]);
	});

	it("omits empty buckets instead of emitting blank sections", () => {
		const result = groupProjects(
			[item({ name: "A", path: "100 Projects/A/A.md" })],
			noneSettings,
			{ folderNotes: folders },
		);
		expect(toSectionSpecs(result).map((spec) => spec.name)).toEqual(["有资料"]);
	});

	it("treats everything as 没资料 when the caller supplies no notes at all", () => {
		// 没提供 folderNotes = 不知道有没有资料，此时不该把大家都算成「有资料」
		const result = groupProjects([item({ name: "A", path: "100 Projects/A/A.md" })], noneSettings);
		expect(result.normalGroups.map((group) => group.title)).toEqual(["没资料"]);
	});

	it("prefixes section keys so they cannot collide with folder paths or area values", () => {
		const result = groupProjects(
			[item({ name: "quick", path: "100 Projects/quick.md" })],
			noneSettings,
			{ folderNotes: folders },
		);
		for (const key of [
			...result.quickGroups.map((group) => group.folder),
			...result.normalGroups.map((group) => group.key),
		]) {
			expect(key.startsWith("kind:")).toBe(true);
		}
	});

	it("still reports per-project materials so the panel can pick card styles", () => {
		const result = groupProjects(
			[
				item({ name: "A", path: "100 Projects/A/A.md" }),
				item({ name: "B", path: "100 Projects/B/B.md" }),
			],
			noneSettings,
			{ folderNotes: folders },
		);
		expect(result.materialsByPath["100 Projects/A/A.md"]).toHaveLength(1);
		expect(result.materialsByPath["100 Projects/B/B.md"]).toEqual([]);
	});
});

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

describe("资料/笔记归集（用户口径 2026-09-18：资料放在项目文件夹的子文件夹里）", () => {
	/** 项目文件夹 = 项目文档 + 其子文件夹里的资料；资料是无项目信息的普通笔记 */
	const vaultNotes: FolderNotes = {
		"100 Projects/官网改版": [{ path: "100 Projects/官网改版/官网改版.md", name: "官网改版" }],
		"100 Projects/官网改版/资料": [
			{ path: "100 Projects/官网改版/资料/需求.md", name: "需求" },
			{ path: "100 Projects/官网改版/资料/会议.md", name: "会议" },
		],
		"100 Projects/官网改版/资料/会议记录": [
			{ path: "100 Projects/官网改版/资料/会议记录/0901.md", name: "0901" },
		],
		"100 Projects/别的项目": [{ path: "100 Projects/别的项目/别的项目.md", name: "别的项目" }],
	};

	const projects = [
		item({ name: "官网改版", path: "100 Projects/官网改版/官网改版.md", mainProject: true }),
		item({ name: "别的项目", path: "100 Projects/别的项目/别的项目.md" }),
	];

	it("counts materials recursively through subfolders, not just direct children", () => {
		const result = groupProjects(projects, DEFAULT_SETTINGS, { folderNotes: vaultNotes });
		const group = result.normalGroups.find((g) => g.key === "100 Projects/官网改版");
		expect(group?.notes?.total).toBe(3);
		// 按路径码点序：会 U+4F1A < 需 U+9700；同为「会议」时 "." (U+002E) < "记"
		expect(group?.notes?.shown.map((n) => n.name)).toEqual(["会议", "0901", "需求"]);
	});

	it("does not count the project document itself as material", () => {
		const result = groupProjects(projects, DEFAULT_SETTINGS, { folderNotes: vaultNotes });
		const group = result.normalGroups.find((g) => g.key === "100 Projects/官网改版");
		expect(group?.notes?.shown.some((n) => n.path.endsWith("官网改版.md"))).toBe(false);
	});

	it("never lets one project's materials leak into another project's count", () => {
		const result = groupProjects(projects, DEFAULT_SETTINGS, { folderNotes: vaultNotes });
		const other = result.normalGroups.find((g) => g.key === "100 Projects/别的项目");
		expect(other?.notes?.total).toBe(0);
	});

	it("does not count other project documents as materials (项目文档不是资料)", () => {
		const folderNotes: FolderNotes = {
			"100 Projects/官网": [
				{ path: "100 Projects/官网/main.md", name: "main" },
				{ path: "100 Projects/官网/sub.md", name: "sub" },
				{ path: "100 Projects/官网/资料/note.md", name: "note" },
			],
		};
		const result = groupProjects(
			[
				item({ name: "main", path: "100 Projects/官网/main.md", mainProject: true }),
				item({ name: "sub", path: "100 Projects/官网/sub.md" }),
			],
			DEFAULT_SETTINGS,
			{
				folderNotes,
				projectPaths: ["100 Projects/官网/main.md", "100 Projects/官网/sub.md"],
			},
		);
		const group = result.normalGroups[0];
		expect(group?.notes?.shown.map((n) => n.name)).toEqual(["note"]);
		expect(group?.notes?.total).toBe(1);
	});

	it("truncates at maxNotesPerProject while total keeps the real count", () => {
		const result = groupProjects(projects, { ...DEFAULT_SETTINGS, maxNotesPerProject: 1 }, {
			folderNotes: vaultNotes,
		});
		const group = result.normalGroups.find((g) => g.key === "100 Projects/官网改版");
		expect(group?.notes?.shown).toHaveLength(1);
		expect(group?.notes?.remaining).toBe(2);
		expect(group?.notes?.total).toBe(3);
	});

	it("aggregates materials across folders in objective grouping mode", () => {
		// 值分组横跨多个文件夹，所以必须把「全部项目文档」传进来才能把项目文档排除干净
		const result = groupProjects(projects, { ...DEFAULT_SETTINGS, defaultGrouping: "objective" }, {
			folderNotes: vaultNotes,
			projectPaths: projects.map((p) => p.file.path),
		});
		const group = result.normalGroups[0];
		expect(group?.notes?.total).toBe(3);
	});
});

describe("快速项目判定（面板与甘特共用的唯一口径）", () => {
	it("treats scan-folder root-level projects as quick", () => {
		expect(isQuickProject(item({ name: "q", path: "100 Projects/q.md" }), DEFAULT_SETTINGS)).toBe(
			true,
		);
	});

	it("treats projects inside a marker folder as quick, at any depth", () => {
		const settings = { ...DEFAULT_SETTINGS, scanFolders: ["100 Projects"] };
		expect(
			isQuickProject(item({ name: "a", path: "100 Projects/快速项目/a.md" }), settings),
		).toBe(true);
		expect(
			isQuickProject(item({ name: "b", path: "100 Projects/市场部/快速项目/deep/b.md" }), settings),
		).toBe(true);
	});

	it("treats a project in its own folder as NOT quick", () => {
		expect(
			isQuickProject(item({ name: "p", path: "100 Projects/官网改版/p.md" }), DEFAULT_SETTINGS),
		).toBe(false);
	});

	it("does not mistake a folder whose name merely contains the marker for a quick folder", () => {
		expect(
			isQuickProject(item({ name: "x", path: "100 Projects/非快速项目集/x.md" }), DEFAULT_SETTINGS),
		).toBe(false);
	});

	it("treats out-of-scope paths as normal projects (never loses data)", () => {
		expect(isQuickProject(item({ name: "o", path: "200 Other/o.md" }), DEFAULT_SETTINGS)).toBe(
			false,
		);
	});

	it("reports quick paths for both folder and value grouping", () => {
		const items = [
			item({ name: "quick", path: "100 Projects/quick.md" }),
			item({ name: "normal", path: "100 Projects/官网/normal.md", objective: "增长" }),
		];
		expect(groupProjects(items, DEFAULT_SETTINGS).quickPaths).toEqual(["100 Projects/quick.md"]);
		// 值分组不会把快速项目单独抽出来（分节必须与甘特一致），但标记仍然要给出
		const byObjective = groupProjects(items, {
			...DEFAULT_SETTINGS,
			defaultGrouping: "objective",
		});
		expect(byObjective.quickGroups).toHaveLength(0);
		expect(byObjective.quickPaths).toEqual(["100 Projects/quick.md"]);
	});
});

describe("按项目归集资料（面板「带资料 / 不带资料」二分的依据）", () => {
	const folderNotes: FolderNotes = {
		"100 Projects/官网改版": [{ path: "100 Projects/官网改版/官网改版.md", name: "官网改版" }],
		"100 Projects/官网改版/资料": [
			{ path: "100 Projects/官网改版/资料/需求.md", name: "需求" },
			{ path: "100 Projects/官网改版/资料/会议.md", name: "会议" },
		],
		"100 Projects/内部工具": [{ path: "100 Projects/内部工具/内部工具.md", name: "内部工具" }],
		"100 Projects": [{ path: "100 Projects/快速.md", name: "快速" }],
	};

	const projects = [
		item({ name: "官网改版", path: "100 Projects/官网改版/官网改版.md", mainProject: true }),
		item({ name: "内部工具", path: "100 Projects/内部工具/内部工具.md" }),
		item({ name: "快速", path: "100 Projects/快速.md" }),
	];

	const result = groupProjects(projects, DEFAULT_SETTINGS, {
		folderNotes,
		projectPaths: projects.map((p) => p.file.path),
	});

	it("attaches materials to the project whose folder holds them", () => {
		expect(result.materialsByPath["100 Projects/官网改版/官网改版.md"]?.map((n) => n.name)).toEqual(
			["会议", "需求"],
		);
	});

	it("gives an empty list to a project with no materials", () => {
		expect(result.materialsByPath["100 Projects/内部工具/内部工具.md"]).toEqual([]);
	});

	it("never attributes scan-root notes to a quick project (it has no folder of its own)", () => {
		// 「快速.md」自己就在扫描根层，根层里的其它笔记不属于它
		expect(result.materialsByPath["100 Projects/快速.md"]).toEqual([]);
	});

	it("is independent from the group-level count in value grouping", () => {
		const byArea = groupProjects(projects, { ...DEFAULT_SETTINGS, defaultGrouping: "area" }, {
			folderNotes,
			projectPaths: projects.map((p) => p.file.path),
		});
		// 分组维度看的是并集，项目维度只看自己那一份
		expect(byArea.materialsByPath["100 Projects/内部工具/内部工具.md"]).toEqual([]);
	});
});

describe("项目形态二分（面板：带资料给框框、不带资料给列表）", () => {
	const withMaterials = item({ name: "带资料", path: "100 Projects/A/带资料.md" });
	const plain = item({ name: "不带资料", path: "100 Projects/B/不带资料.md" });
	const quick = item({ name: "快速", path: "100 Projects/快速.md" });

	const quickPaths = new Set([quick.file.path]);
	const materials: Record<string, { path: string; name: string }[]> = {
		[withMaterials.file.path]: [{ path: "100 Projects/A/资料/x.md", name: "x" }],
		[plain.file.path]: [],
		[quick.file.path]: [],
	};

	it("classifies each project by kind", () => {
		expect(classifyProject(withMaterials, quickPaths, materials)).toBe("with-materials");
		expect(classifyProject(plain, quickPaths, materials)).toBe("plain");
		expect(classifyProject(quick, quickPaths, materials)).toBe("quick");
	});

	it("buckets a group's projects without dropping any", () => {
		const buckets = splitByKind([withMaterials, plain, quick], quickPaths, materials);
		expect(buckets.withMaterials.map((p) => p.file.name)).toEqual(["带资料"]);
		expect(buckets.plain.map((p) => p.file.name)).toEqual(["不带资料"]);
		expect(buckets.quick.map((p) => p.file.name)).toEqual(["快速"]);
	});

	it("prefers 'quick' over 'with-materials' (a quick project has no folder of its own)", () => {
		// 即使快速项目所在目录里恰好有笔记被归集到它头上，也仍然算快速项目
		const polluted = { ...materials, [quick.file.path]: [{ path: "x.md", name: "x" }] };
		expect(classifyProject(quick, quickPaths, polluted)).toBe("quick");
	});

	it("treats a missing materials entry as plain (no crash on partial data)", () => {
		expect(classifyProject(plain, new Set(), {})).toBe("plain");
	});
});

describe("分组标题与甘特分节（左右联动的共用数据）", () => {
	it("titles folder groups with the path relative to the scan folder", () => {
		const result = groupProjects(
			[item({ name: "p", path: "100 Projects/市场部/官网/p.md" })],
			DEFAULT_SETTINGS,
		);
		expect(result.normalGroups[0]?.title).toBe("市场部 > 官网");
	});

	it("keeps the raw value as the title in objective mode", () => {
		const result = groupProjects(
			[item({ name: "p", objective: "增长" })],
			{ ...DEFAULT_SETTINGS, defaultGrouping: "objective" },
		);
		expect(result.normalGroups[0]?.title).toBe("增长");
	});

	it("produces one section per group, quick groups first, in panel order", () => {
		const result = groupProjects(
			[
				item({ name: "quick", path: "100 Projects/quick.md" }),
				item({ name: "a", path: "100 Projects/官网/a.md", dueDate: "2026-12-01" }),
				item({ name: "b", path: "100 Projects/别的/b.md", dueDate: "2026-01-01" }),
			],
			DEFAULT_SETTINGS,
		);
		const specs = toSectionSpecs(result);
		// 关键：分节顺序 = 左面板卡片顺序（正常组按代表 due 降序：官网 12-01 在别的 01-01 之前）
		expect(specs.map((s) => s.name)).toEqual([
			"快速项目（根目录）",
			"官网",
			"别的",
		]);
		expect(specs[0]?.paths).toEqual(["100 Projects/quick.md"]);
		expect(specs.map((s) => s.key)).toEqual([
			"100 Projects",
			"100 Projects/官网",
			"100 Projects/别的",
		]);
	});
});
