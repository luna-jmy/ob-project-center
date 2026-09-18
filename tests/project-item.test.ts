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

describe("buildProjectItem — 识别规则（SPEC §2.1/§2.2）", () => {
	it("builds an item for a type:project note with template fields", () => {
		const result = buildProjectItem(fm(), fileInfo, DEFAULT_SETTINGS);
		expect(result.item).not.toBeNull();
		expect(result.item?.status).toBe("active");
		expect(result.item?.startDate).toBe("2026-09-01");
		expect(result.item?.dueDate).toBe("2026-09-15");
		expect(result.item?.area).toEqual(["CIMS工作"]);
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

	it("normalizes area and members single values to arrays", () => {
		const result = buildProjectItem(
			fm({ "project-members": "Luna" }),
			fileInfo,
			DEFAULT_SETTINGS,
		);
		expect(result.item?.area).toEqual(["CIMS工作"]);
		expect(result.item?.projectMembers).toEqual(["Luna"]);
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
