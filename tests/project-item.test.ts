import { describe, expect, it } from "vitest";
import { buildProjectItem } from "../src/services/project-item";
import { DEFAULT_FIELD_MAPPING, DEFAULT_SETTINGS } from "../src/types";

/** 最小合法 frontmatter（模板字段子集） */
function fm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type: "project",
		status: "active",
		priority: "2",
		start_date: "2026-09-01",
		due_date: "2026-09-15",
		area: "CIMS工作",
		objective: "官网改版",
		...overrides,
	};
}

const fileInfo = {
	path: "100 Projects/官网改版/官网改版.md",
	name: "官网改版",
	folder: "100 Projects/官网改版",
};

/*
 * frontmatter 里的数字：`priority: 2` / `objective: 2026` 手写出来就是**数字**（YAML 不引号即数字）。
 * 规范化层一度只认字符串、把它们悄悄吃掉，表现是「优先级明明设了 2，条子却毫无变化」——
 * 用户口径 2026-09-20 报的就是这个，值就写在笔记里，却找不出原因。
 */
describe("buildProjectItem — 数字型 frontmatter 值", () => {
	it("keeps a numeric priority instead of dropping it", () => {
		const result = buildProjectItem(fm({ priority: 2 }), fileInfo, DEFAULT_SETTINGS);
		expect(result.item?.priority).toBe("2");
	});

	it("keeps other numeric scalars the same way", () => {
		const result = buildProjectItem(fm({ objective: 2026 }), fileInfo, DEFAULT_SETTINGS);
		expect(result.item?.objective).toBe("2026");
	});

	it("still drops values that are neither string nor number", () => {
		const result = buildProjectItem(fm({ priority: true }), fileInfo, DEFAULT_SETTINGS);
		expect(result.item?.priority).toBeNull();
	});
});

describe("buildProjectItem — 识别规则（SPEC §2.1/§2.2）", () => {
	it("builds an item for a type:project note with template fields", () => {
		const result = buildProjectItem(fm(), fileInfo, DEFAULT_SETTINGS);
		expect(result.item).not.toBeNull();
		expect(result.item?.status).toBe("active");
		expect(result.item?.startDate).toBe("2026-09-01");
		expect(result.item?.dueDate).toBe("2026-09-15");
		expect(result.item?.area).toBe("CIMS工作");
		expect(result.item?.file.path).toBe(fileInfo.path);
		expect(result.issues).toEqual([]);
	});

	it("rejects notes whose type does not match the mapping", () => {
		const result = buildProjectItem(
			fm({ type: "meeting" }),
			fileInfo,
			DEFAULT_SETTINGS,
		);
		expect(result.item).toBeNull();
	});

	it("accepts type regardless of case/whitespace", () => {
		const result = buildProjectItem(fm({ type: " Project " }), fileInfo, DEFAULT_SETTINGS);
		expect(result.item).not.toBeNull();
	});

	it("supports identifyTag as supplementary identification", () => {
		// 无 type 字段但带识别标签（SPEC §5.2 identifyTag 默认 project）
		const result = buildProjectItem(
			{ tags: ["project"] },
			fileInfo,
			DEFAULT_SETTINGS,
		);
		expect(result.item).not.toBeNull();
		expect(result.item?.tags).toEqual(["project"]);
	});

	it("rejects notes with neither type nor identifyTag", () => {
		const result = buildProjectItem({ status: "active" }, fileInfo, DEFAULT_SETTINGS);
		expect(result.item).toBeNull();
	});
});

describe("buildProjectItem — 规范化行为（SPEC §2.3）", () => {
	it("maps chinese status alias to canonical value", () => {
		const result = buildProjectItem(fm({ status: "执行中" }), fileInfo, DEFAULT_SETTINGS);
		expect(result.item?.status).toBe("active");
	});

	it("keeps unknown status as null and reports an issue", () => {
		const result = buildProjectItem(fm({ status: "乱写" }), fileInfo, DEFAULT_SETTINGS);
		expect(result.item?.status).toBeNull();
		expect(result.issues.some((issue) => issue.field === "status")).toBe(true);
	});

	it("falls back end_date → dueDate when due_date is missing", () => {
		const result = buildProjectItem(
			fm({ due_date: undefined, end_date: "2026-10-01" }),
			fileInfo,
			DEFAULT_SETTINGS,
		);
		expect(result.item?.dueDate).toBe("2026-10-01");
	});

	it("prefers due_date over end_date when both exist", () => {
		const result = buildProjectItem(
			fm({ due_date: "2026-09-15", end_date: "2026-10-01" }),
			fileInfo,
			DEFAULT_SETTINGS,
		);
		expect(result.item?.dueDate).toBe("2026-09-15");
	});

	it("normalizes a single area to that value, and single members to an array", () => {
		const result = buildProjectItem(
			fm({ "project-members": "Luna" }),
			fileInfo,
			DEFAULT_SETTINGS,
		);
		expect(result.item?.area).toBe("CIMS工作");
		expect(result.item?.projectMembers).toEqual(["Luna"]);
	});

	/*
	 * 领域是单值（用户口径 2026-09-21）：它是分组维度，多值会让分组失效——旧实现
	 * 允许写多个，分组却只认第一个，其余值在分组里根本看不见。
	 *
	 * 老笔记里的数组写法按「取第一个」读入：与旧分组行为完全一致，所以改完之后
	 * 这些项目不会突然从某个分组掉进「未设置」。
	 */
	it("takes the first value from a legacy multi-value area", () => {
		const legacy = buildProjectItem(
			fm({ area: ["市场", "运营"] }),
			fileInfo,
			DEFAULT_SETTINGS,
		);
		expect(legacy.item?.area).toBe("市场");

		// 空数组 / 空白值 = 没写领域，与缺失同义
		const empty = buildProjectItem(fm({ area: [] }), fileInfo, DEFAULT_SETTINGS);
		expect(empty.item?.area).toBeNull();

		const blank = buildProjectItem(fm({ area: ["", "  "] }), fileInfo, DEFAULT_SETTINGS);
		expect(blank.item?.area).toBeNull();
	});

	it("reports invalid dates as issues and stores null (no silent fix)", () => {
		const result = buildProjectItem(
			fm({ start_date: "2026-02-30" }),
			fileInfo,
			DEFAULT_SETTINGS,
		);
		expect(result.item?.startDate).toBeNull();
		expect(
			result.issues.some((issue) => issue.field === "startDate" && issue.reason === "invalid-date"),
		).toBe(true);
	});

	it("missing dates are null but produce no issues", () => {
		const result = buildProjectItem(
			fm({ start_date: undefined, due_date: undefined }),
			fileInfo,
			DEFAULT_SETTINGS,
		);
		expect(result.item?.startDate).toBeNull();
		expect(result.item?.dueDate).toBeNull();
		expect(result.issues).toEqual([]);
	});

	it("parses progress with % suffix and clamps", () => {
		const over = buildProjectItem(fm({ progress: "150%" }), fileInfo, DEFAULT_SETTINGS);
		expect(over.item?.progress).toBe(100);
	});

	it("normalizes long-term / main-project booleans", () => {
		const result = buildProjectItem(
			fm({ "long-term": "true", "main-project": true }),
			fileInfo,
			DEFAULT_SETTINGS,
		);
		expect(result.item?.longTerm).toBe(true);
		expect(result.item?.mainProject).toBe(true);
	});

	it("keeps priority as raw string (display mapping happens in UI layer)", () => {
		const result = buildProjectItem(fm({ priority: "1" }), fileInfo, DEFAULT_SETTINGS);
		expect(result.item?.priority).toBe("1");
	});
});

describe("buildProjectItem — 参数分离（SPEC §5.2）", () => {
	it("reads physical fields through the field mapping", () => {
		const settings = {
			...DEFAULT_SETTINGS,
			fieldMapping: {
				...DEFAULT_FIELD_MAPPING,
				status: "proj-status",
				startDate: "von",
				dueDate: "bis",
			},
		};
		const result = buildProjectItem(
			{
				type: "project",
				"proj-status": "执行中",
				von: "2026-01-01",
				bis: "2026-02-01",
			},
			fileInfo,
			settings,
		);
		expect(result.item?.status).toBe("active");
		expect(result.item?.startDate).toBe("2026-01-01");
		expect(result.item?.dueDate).toBe("2026-02-01");
	});

	it("frontmatter tags come from cache tags plus frontmatter tags field", () => {
		const result = buildProjectItem(
			fm({ tags: ["project", "favorite"] }),
			fileInfo,
			DEFAULT_SETTINGS,
		);
		expect(result.item?.tags).toContain("project");
		expect(result.item?.tags).toContain("favorite");
	});
});
