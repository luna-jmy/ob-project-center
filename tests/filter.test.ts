import { describe, expect, it } from "vitest";
import {
	applyFilters,
	COMPLETED_LIKE_STATUSES,
	defaultFilterState,
	presetToStatuses,
	resolveDateRange,
	sortProjects,
} from "../src/services/filter-service";
import { ProjectItem, ProjectStatus } from "../src/types";

/** 构造测试项目条目（只填筛选相关字段） */
function item(overrides: Partial<ProjectItem> & { name: string }): ProjectItem {
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
		file: { path: `100 Projects/${overrides.name}.md`, name: overrides.name, folder: "100 Projects" },
		...overrides,
	};
}

describe("status 预设（继承 projectOverview.js completedStatuses 集合）", () => {
	it("completed-like set covers completed/cancelled/archived", () => {
		expect(COMPLETED_LIKE_STATUSES).toEqual(["completed", "cancelled", "archived"]);
	});

	it("hide-completed preset = all statuses minus completed-like", () => {
		const statuses = presetToStatuses("hide-completed");
		expect(statuses).toContain("active");
		expect(statuses).toContain("inbox");
		expect(statuses).not.toContain("completed");
		expect(statuses).not.toContain("cancelled");
		expect(statuses).not.toContain("archived");
	});

	it("completed-only preset = completed-like set", () => {
		expect(presetToStatuses("completed-only")).toEqual(COMPLETED_LIKE_STATUSES);
	});

	it("all preset = every status", () => {
		expect(presetToStatuses("all")).toHaveLength(7);
	});
});

describe("applyFilters — status 多选（F2.1）", () => {
	it("keeps only selected statuses (arbitrary combination)", () => {
		const items = [
			item({ name: "a", status: "active" }),
			item({ name: "b", status: "draft" }),
			item({ name: "c", status: "on-hold" }),
		];
		const state = { ...defaultFilterState(), statuses: ["active", "on-hold"] as ProjectStatus[] };
		expect(applyFilters(items, state).map((i) => i.file.name)).toEqual(["a", "c"]);
	});

	it("empty selection means no filtering", () => {
		const items = [item({ name: "a", status: "completed" }), item({ name: "b", status: "active" })];
		const state = defaultFilterState();
		expect(applyFilters(items, state)).toHaveLength(2);
	});

	it("null status items drop out once any status filter is active", () => {
		const items = [item({ name: "a", status: null }), item({ name: "b", status: "active" })];
		const state = { ...defaultFilterState(), statuses: ["active"] as ProjectStatus[] };
		expect(applyFilters(items, state).map((i) => i.file.name)).toEqual(["b"]);
	});
});

describe("applyFilters — area 筛选（F2.2）", () => {
	it("selected mode: OR across multiple selected areas", () => {
		const items = [
			item({ name: "a", area: ["CIMS工作"] }),
			item({ name: "b", area: ["个人成长"] }),
			item({ name: "c", area: ["CIMS工作", "个人成长"] }),
			item({ name: "d", area: [] }),
		];
		const state = {
			...defaultFilterState(),
			areaMode: "selected" as const,
			areas: ["CIMS工作", "个人成长"],
		};
		expect(applyFilters(items, state).map((i) => i.file.name)).toEqual(["a", "b", "c"]);
	});

	it("include-current mode: keep projects intersecting current areas", () => {
		const items = [
			item({ name: "a", area: ["CIMS工作"] }),
			item({ name: "b", area: ["家庭"] }),
			item({ name: "none", area: [] }),
		];
		const state = {
			...defaultFilterState(),
			areaMode: "include-current" as const,
			currentAreas: ["CIMS工作", "市场"],
		};
		expect(applyFilters(items, state).map((i) => i.file.name)).toEqual(["a"]);
	});

	it("exclude-current mode: drop intersecting, keep disjoint (incl. empty area)", () => {
		const items = [
			item({ name: "a", area: ["CIMS工作"] }),
			item({ name: "b", area: ["家庭"] }),
			item({ name: "none", area: [] }),
		];
		const state = {
			...defaultFilterState(),
			areaMode: "exclude-current" as const,
			currentAreas: ["CIMS工作"],
		};
		expect(applyFilters(items, state).map((i) => i.file.name)).toEqual(["b", "none"]);
	});
});

describe("applyFilters — 搜索（F2.3）", () => {
	it("case-insensitive substring match on note name", () => {
		const items = [item({ name: "官网改版" }), item({ name: "Marketing Revamp" })];
		const state = { ...defaultFilterState(), search: "revamp" };
		expect(applyFilters(items, state).map((i) => i.file.name)).toEqual(["Marketing Revamp"]);
	});

	it("chinese keyword matches chinese name", () => {
		const items = [item({ name: "官网改版" }), item({ name: "市场活动" })];
		const state = { ...defaultFilterState(), search: "官网" };
		expect(applyFilters(items, state).map((i) => i.file.name)).toEqual(["官网改版"]);
	});
});

describe("resolveDateRange — 预设解析（today 注入，测试可控）", () => {
	// 2026-09-18 是周五
	const today = "2026-09-18";

	it("week preset spans Sun..Sat (script behavior)", () => {
		expect(resolveDateRange("week", today)).toEqual({
			start: "2026-09-13",
			end: "2026-09-19",
		});
	});

	it("month preset spans the whole month", () => {
		expect(resolveDateRange("month", today)).toEqual({
			start: "2026-09-01",
			end: "2026-09-30",
		});
	});

	it("quarter preset spans the calendar quarter", () => {
		expect(resolveDateRange("quarter", today)).toEqual({
			start: "2026-07-01",
			end: "2026-09-30",
		});
	});

	it("year preset spans the calendar year", () => {
		expect(resolveDateRange("year", today)).toEqual({
			start: "2026-01-01",
			end: "2026-12-31",
		});
	});

	it("all preset means no date filtering", () => {
		expect(resolveDateRange("all", today)).toEqual({ start: null, end: null });
	});
});

describe("applyFilters — 日期区间匹配（规则表逐条转写自 projectOverview.js/projectGantt.js）", () => {
	function stateWithRange(start: string | null, end: string | null) {
		return {
			...defaultFilterState(),
			dateRange: { preset: "custom" as const, start, end },
		};
	}

	it("full range + project with both dates: interval intersection (inclusive bounds)", () => {
		const items = [
			item({ name: "inside", startDate: "2026-09-01", dueDate: "2026-09-15" }),
			item({ name: "edge-start", startDate: "2026-01-01", dueDate: "2026-01-01" }),
			item({ name: "crosses-start", startDate: "2025-06-01", dueDate: "2026-06-30" }),
			item({ name: "after", startDate: "2027-01-01", dueDate: "2027-06-01" }),
		];
		const names = applyFilters(items, stateWithRange("2026-01-01", "2026-12-31")).map(
			(i) => i.file.name,
		);
		expect(names).toContain("inside");
		expect(names).toContain("edge-start");
		expect(names).toContain("crosses-start");
		expect(names).not.toContain("after");
	});

	it("full range + start-only project: start must fall inside range", () => {
		const items = [
			item({ name: "ok", startDate: "2026-05-01" }),
			item({ name: "late", startDate: "2027-03-01" }),
			item({ name: "early", startDate: "2025-03-01" }),
		];
		const names = applyFilters(items, stateWithRange("2026-01-01", "2026-12-31")).map(
			(i) => i.file.name,
		);
		expect(names).toEqual(["ok"]);
	});

	it("full range + end-only project: end must fall inside range", () => {
		const items = [
			item({ name: "ok", dueDate: "2026-02-01" }),
			item({ name: "before", dueDate: "2025-12-31" }),
			item({ name: "after", dueDate: "2027-02-01" }),
		];
		const names = applyFilters(items, stateWithRange("2026-01-01", "2026-12-31")).map(
			(i) => i.file.name,
		);
		expect(names).toEqual(["ok"]);
	});

	it("range with start only: keep projects starting/ending on/after the bound", () => {
		const items = [
			item({ name: "start-later", startDate: "2026-07-01" }),
			item({ name: "start-earlier", startDate: "2026-01-01" }),
			item({ name: "end-later", dueDate: "2026-08-01" }),
			item({ name: "end-earlier", dueDate: "2026-05-01" }),
			item({ name: "no-dates" }),
		];
		const names = applyFilters(items, stateWithRange("2026-06-01", null)).map(
			(i) => i.file.name,
		);
		expect(names).toEqual(["start-later", "end-later", "no-dates"]);
	});

	it("range with end only: keep projects starting/ending on/before the bound", () => {
		const items = [
			item({ name: "start-before", startDate: "2026-05-01" }),
			item({ name: "start-after", startDate: "2026-08-01" }),
			item({ name: "end-before", dueDate: "2026-06-30" }),
			item({ name: "end-after", dueDate: "2026-08-01" }),
			item({ name: "no-dates" }),
		];
		const names = applyFilters(items, stateWithRange(null, "2026-06-30")).map(
			(i) => i.file.name,
		);
		expect(names).toEqual(["start-before", "end-before", "no-dates"]);
	});

	it("long-term projects bypass date filtering (existing rule)", () => {
		const items = [
			item({ name: "lt", longTerm: true, startDate: "2024-01-01", dueDate: "2024-06-01" }),
		];
		const names = applyFilters(items, stateWithRange("2026-01-01", "2026-12-31")).map(
			(i) => i.file.name,
		);
		expect(names).toEqual(["lt"]);
	});

	it("dateless projects stay visible under overview semantics (gantt adapter excludes them)", () => {
		const items = [item({ name: "no-dates" })];
		const names = applyFilters(items, stateWithRange("2026-01-01", "2026-12-31")).map(
			(i) => i.file.name,
		);
		expect(names).toEqual(["no-dates"]);
	});
});

describe("sortProjects（F2.6）", () => {
	it("due-asc: earliest due first, null due last", () => {
		const items = [
			item({ name: "none" }),
			item({ name: "c", dueDate: "2026-12-01" }),
			item({ name: "a", dueDate: "2026-01-01" }),
			item({ name: "b", dueDate: "2026-06-01" }),
		];
		expect(sortProjects(items, "due-asc").map((i) => i.file.name)).toEqual([
			"a",
			"b",
			"c",
			"none",
		]);
	});

	it("name: locale-aware ascending", () => {
		const items = [item({ name: "b" }), item({ name: "a" }), item({ name: "中文" })];
		const sorted = sortProjects(items, "name").map((i) => i.file.name);
		expect(sorted[0]).toBe("a");
		expect(sorted[1]).toBe("b");
	});

	it("priority: 1 (highest) first, invalid values last", () => {
		const items = [
			item({ name: "p3", priority: "3" }),
			item({ name: "p1", priority: "1" }),
			item({ name: "bad", priority: "urgent" }),
			item({ name: "p2", priority: "2" }),
		];
		expect(sortProjects(items, "priority").map((i) => i.file.name)).toEqual([
			"p1",
			"p2",
			"p3",
			"bad",
		]);
	});
});

describe("applyFilters — 组合行为（F2.7 一套管道两处渲染）", () => {
	it("conditions compose with AND and count via input length", () => {
		const items = [
			item({ name: "官网改版", status: "active", area: ["CIMS工作"], dueDate: "2026-09-10" }),
			item({ name: "官网移动端", status: "draft", area: ["CIMS工作"], dueDate: "2026-09-20" }),
			item({ name: "家庭旅行", status: "active", area: ["家庭"], dueDate: "2026-09-05" }),
		];
		const state = {
			...defaultFilterState(),
			statuses: ["active"] as ProjectStatus[],
			areaMode: "selected" as const,
			areas: ["CIMS工作"],
			dateRange: { preset: "custom" as const, start: "2026-09-01", end: "2026-09-30" },
		};
		expect(applyFilters(items, state).map((i) => i.file.name)).toEqual(["官网改版"]);
	});
});
