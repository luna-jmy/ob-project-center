import { describe, expect, it } from "vitest";
import {
	buildNewProjectPatch,
	buildProjectPatch,
	collectSuggestions,
	editorValuesFromItem,
	emptyEditorValues,
	formatListInput,
	parseDateInput,
	parseListInput,
	parseNumberInput,
} from "../src/services/frontmatter-mapping";
import { DEFAULT_FIELD_MAPPING, FieldMappingConfig } from "../src/types";
import { projectItem } from "./fixtures";

/** 换过字段名的映射表：用来证明 UI/写回层真的没有硬编码物理字段名 */
const RENAMED: FieldMappingConfig = {
	...DEFAULT_FIELD_MAPPING,
	status: "状态",
	startDate: "开始",
	dueDate: "截止",
	area: "领域",
	remark: "备注",
	longTerm: "长期",
	mainProject: "主项目",
	identifyTag: "proj",
};

describe("编辑表单 → frontmatter patch（SPEC §5.2 单一映射层）", () => {
	it("maps every logical field onto the physical name from the mapping", () => {
		const values = { ...emptyEditorValues(), status: "active" as const, startDate: "2026-01-01" };
		const patch = buildProjectPatch(values, RENAMED);
		expect(patch["状态"]).toBe("active");
		expect(patch["开始"]).toBe("2026-01-01");
		expect(patch["type"]).toBeUndefined();
		expect(patch["status"]).toBeUndefined();
	});

	it("writes null for cleared scalars so the field is removed, not blanked", () => {
		const patch = buildProjectPatch(emptyEditorValues(), DEFAULT_FIELD_MAPPING);
		expect(patch["status"]).toBeNull();
		expect(patch["start_date"]).toBeNull();
		expect(patch["due_date"]).toBeNull();
		expect(patch["objective"]).toBeNull();
	});

	it("deletes fields when empty and writes them when populated", () => {
		const cleared = buildProjectPatch(emptyEditorValues(), DEFAULT_FIELD_MAPPING);
		expect(cleared["area"]).toBeNull();
		expect(cleared["project-members"]).toBeNull();

		const filled = buildProjectPatch(
			{ ...emptyEditorValues(), area: "A", projectMembers: ["Luna"] },
			DEFAULT_FIELD_MAPPING,
		);
		// 领域是标量（分组维度，多值会让分组失效），成员仍是数组
		expect(filled["area"]).toBe("A");
		expect(filled["project-members"]).toEqual(["Luna"]);
	});

	it("always writes booleans so turning a switch off actually sticks", () => {
		const patch = buildProjectPatch(emptyEditorValues(), DEFAULT_FIELD_MAPPING);
		// false 而不是 null：字段在模板里是常驻的
		expect(patch["long-term"]).toBe(false);
		expect(patch["main-project"]).toBe(false);
	});

	it("keeps progress 0 as a real value (not treated as empty)", () => {
		const patch = buildProjectPatch(
			{ ...emptyEditorValues(), progress: 0 },
			DEFAULT_FIELD_MAPPING,
		);
		expect(patch["progress"]).toBe(0);
	});

	it("writes the remark through the mapping, and removes it when cleared", () => {
		// 备注走普通标量语义：有值写值、清空则删字段（用户口径 2026-09-21）
		expect(buildProjectPatch(emptyEditorValues(), DEFAULT_FIELD_MAPPING)["remark"]).toBeNull();
		const filled = buildProjectPatch(
			{ ...emptyEditorValues(), remark: "改状态：等设计出图" },
			RENAMED,
		);
		expect(filled["备注"]).toBe("改状态：等设计出图");
		expect(filled["remark"]).toBeUndefined();
	});
});

/*
 * 已有值候选（用户口径 2026-09-21）：领域 / 目标 / 负责人 / 成员。
 *
 * 目的不是下拉好看，而是让同一批项目尽量用**同一套写法**——「市场」与「市场部」
 * 混着写，分组和筛选会悄悄裂成两拨，界面上还看不出为什么。
 */
describe("已有值候选（编辑弹窗的下拉与点选标签）", () => {
	it("collects、trims、deduplicates and sorts values from every project", () => {
		const items = [
			projectItem({
				name: "a",
				area: "市场",
				objective: "增长",
				projectLeader: "Luna",
				projectMembers: ["A", "B"],
			}),
			projectItem({
				name: "b",
				area: " 运营 ",
				objective: "增长",
				projectLeader: "  Kite ",
				projectMembers: ["B", ""],
			}),
		];
		const suggestions = collectSuggestions(items);
		// 码点序：Luna(L) < Kite(K)? —— 大写字母里 K < L，所以 Kite 在前
		expect(suggestions.area).toEqual(["市场", "运营"]);
		expect(suggestions.objective).toEqual(["增长"]);
		expect(suggestions.projectLeader).toEqual(["Kite", "Luna"]);
		expect(suggestions.projectMembers).toEqual(["A", "B"]);
	});

	it("returns empty lists when nothing is filled in yet", () => {
		expect(collectSuggestions([projectItem({ name: "empty" })])).toEqual({
			area: [],
			objective: [],
			projectLeader: [],
			projectMembers: [],
		});
	});
});

describe("新建项目 patch（SPEC F4.1）", () => {
	it("adds the type flag and the identify tag", () => {
		const patch = buildNewProjectPatch(emptyEditorValues(), DEFAULT_FIELD_MAPPING);
		expect(patch["type"]).toBe("project");
		expect(patch["tags"]).toEqual(["project"]);
	});

	it("uses the configured identify tag and type field name", () => {
		const patch = buildNewProjectPatch(
			emptyEditorValues(),
			{ ...RENAMED, type: "类型" },
		);
		expect(patch["类型"]).toBe("project");
		expect(patch["tags"]).toEqual(["proj"]);
	});

	it("tags is a native Obsidian field and never goes through the mapping table", () => {
		const patch = buildNewProjectPatch(emptyEditorValues(), RENAMED);
		expect(patch["tags"]).toEqual(["proj"]);
		expect(Object.keys(patch)).not.toContain("识别标签");
	});
});

describe("索引条目 → 表单初值", () => {
	it("round-trips the values that came from the index", () => {
		const item = projectItem({
			name: "p",
			status: "on-hold",
			priority: "2",
			startDate: "2026-01-01",
			dueDate: "2026-02-01",
			progress: 40,
			area: "市场",
			objective: "增长",
			projectLeader: "Luna",
			projectMembers: ["A", "B"],
			remark: "停一周等排期",
			longTerm: true,
			mainProject: true,
		});
		const values = editorValuesFromItem(item);
		expect(values).toEqual({
			status: "on-hold",
			priority: "2",
			startDate: "2026-01-01",
			dueDate: "2026-02-01",
			completionDate: null,
			progress: 40,
			area: "市场",
			objective: "增长",
			projectLeader: "Luna",
			projectMembers: ["A", "B"],
			remark: "停一周等排期",
			longTerm: true,
			mainProject: true,
			color: null,
		});
	});

	it("copies arrays instead of aliasing the indexed item", () => {
		const item = projectItem({ name: "p", projectMembers: ["Luna"] });
		const values = editorValuesFromItem(item);
		values.projectMembers.push("Kite");
		expect(item.projectMembers).toEqual(["Luna"]);
	});

	it("keeps an unparseable status as null so the dropdown can show「未设置」", () => {
		const values = editorValuesFromItem(projectItem({ name: "p", status: null }));
		expect(values.status).toBeNull();
	});
});

describe("输入解析（表单里的自由文本）", () => {
	it("splits lists on both full-width and half-width commas and newlines", () => {
		expect(parseListInput("A, B，C\nD")).toEqual(["A", "B", "C", "D"]);
	});

	it("drops blanks and duplicates while keeping order", () => {
		expect(parseListInput(" A ,, A , B ")).toEqual(["A", "B"]);
	});

	it("formats a list for display", () => {
		expect(formatListInput(["A", "B"])).toBe("A, B");
	});

	it("treats a blank date as null (means delete the field)", () => {
		expect(parseDateInput("")).toBeNull();
		expect(parseDateInput("   ")).toBeNull();
		expect(parseDateInput(null)).toBeNull();
		expect(parseDateInput(undefined)).toBeNull();
		expect(parseDateInput("2026-01-01")).toBe("2026-01-01");
	});

	it("clamps numeric input into range and rejects junk", () => {
		expect(parseNumberInput("120", 0, 100)).toBe(100);
		expect(parseNumberInput("-5", 0, 100)).toBe(0);
		expect(parseNumberInput("80", 0, 100)).toBe(80);
		expect(parseNumberInput("", 0, 100)).toBeNull();
		expect(parseNumberInput("abc", 0, 100)).toBeNull();
		expect(parseNumberInput("1.5", 0, 100)).toBeNull();
	});
});
