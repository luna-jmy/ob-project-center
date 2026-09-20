import { describe, expect, it } from "vitest";
import {
	applyFilters,
	collectYears,
	COMPLETED_LIKE_STATUSES,
	defaultFilterState,
	detectStatusPreset,
	hasActiveFilter,
	initialFilterState,
	presetToStatuses,
	resolveDateRange,
	sortProjects,
	toggle,
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
		color: null,
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

describe("年度筛选（用户要求 2026-09-18：按开始年度/结束年度快速缩小范围）", () => {
	const items = [
		item({ name: "去年启动", startDate: "2025-03-01", dueDate: "2026-06-30" }),
		item({ name: "今年启动", startDate: "2026-01-15", dueDate: "2027-03-31" }),
		item({ name: "明年启动", startDate: "2027-02-01", dueDate: "2027-12-31" }),
		item({ name: "无开始日期", dueDate: "2026-05-01" }),
		item({ name: "完全没有日期" }),
	];

	function stateWithYears(startYear: number | null, endYear: number | null) {
		return { ...defaultFilterState(), startYear, endYear };
	}

	it("filters strictly by the year of start_date", () => {
		const result = applyFilters(items, stateWithYears(2026, null));
		expect(result.map((i) => i.file.name)).toEqual(["今年启动"]);
	});

	it("filters strictly by the year of due_date", () => {
		const result = applyFilters(items, stateWithYears(null, 2026));
		expect(result.map((i) => i.file.name)).toEqual(["去年启动", "无开始日期"]);
	});

	it("combines start year and end year with AND (projects spanning into the chosen year)", () => {
		const result = applyFilters(items, stateWithYears(2025, 2026));
		expect(result.map((i) => i.file.name)).toEqual(["去年启动"]);
	});

	it("excludes dateless projects instead of silently keeping them", () => {
		// 这是与 dateRange 刻意不同的口径：区间筛选保留无日期项目（overview 语义），
		// 年度筛选严格匹配——否则「按开始年度」这个筛选会被无日期项目稀释掉。
		const result = applyFilters(items, stateWithYears(2026, 2026));
		expect(result.map((i) => i.file.name)).toEqual([]);
	});

	it("is a no-op when both years are null", () => {
		expect(applyFilters(items, stateWithYears(null, null))).toHaveLength(items.length);
	});

	/*
	 * long-term 豁免（用户口径 2026-09-20 修订）。
	 *
	 * 原先这里**不**豁免，理由是「年度筛选就是为了缩小范围」。实际用下来那条理由是错的：
	 * 长期项目本来就没有起止时间 → 永远不匹配任何年度 → 而默认年度筛选正是
	 * 「只看本年度启动」→ 标了长期反而完全看不见，这个标记等于没兑现。
	 * 现在两种筛选口径一致：都豁免 longTerm。
	 */
	it("exempts long-term projects from the year filter too (was: deliberately not exempt)", () => {
		const withLongTerm = [
			...items,
			item({ name: "长期项目", startDate: "2020-01-01", longTerm: true }),
			item({ name: "长期无日期", longTerm: true }),
		];
		// 区间筛选会豁免它
		const rangeState = {
			...defaultFilterState(),
			dateRange: { preset: "custom" as const, start: "2026-01-01", end: "2026-12-31" },
		};
		expect(applyFilters(withLongTerm, rangeState).map((i) => i.file.name)).toEqual(
			expect.arrayContaining(["长期项目", "长期无日期"]),
		);
		// 年度筛选同样豁免——关键在于「没有任何日期的长期项目」也能留下来
		expect(applyFilters(withLongTerm, stateWithYears(2026, null)).map((i) => i.file.name)).toEqual(
			["今年启动", "长期项目", "长期无日期"],
		);
	});
});

describe("年度候选收集（下拉选项由数据驱动）", () => {
	it("collects years from both start and due dates, newest first, deduped", () => {
		const years = collectYears([
			item({ name: "a", startDate: "2025-03-01", dueDate: "2026-06-30" }),
			item({ name: "b", startDate: "2026-01-15", dueDate: "2027-03-31" }),
			item({ name: "c" }),
		]);
		expect(years).toEqual([2027, 2026, 2025]);
	});

	it("returns an empty list when nothing has dates", () => {
		expect(collectYears([item({ name: "a" })])).toEqual([]);
	});
});

describe("默认筛选状态与「清除筛选」（用户要求：默认只看本年启动的项目）", () => {
	it("defaults the start year to the current year derived from the injected today", () => {
		expect(initialFilterState("2026-09-18").startYear).toBe(2026);
		expect(initialFilterState("2030-01-01").startYear).toBe(2030);
	});

	it("leaves the end year open by default", () => {
		expect(initialFilterState("2026-09-18").endYear).toBeNull();
	});

	it("keeps the neutral baseline free of any filtering", () => {
		const baseline = defaultFilterState();
		expect(baseline.startYear).toBeNull();
		expect(baseline.endYear).toBeNull();
		expect(baseline.statuses).toEqual([]);
	});

	it("reports the default state as 'no active filter' so the clear button stays hidden", () => {
		expect(hasActiveFilter(initialFilterState("2026-09-18"), "2026-09-18")).toBe(false);
	});

	it("reports an active filter once a year differs from the default", () => {
		const state = { ...initialFilterState("2026-09-18"), startYear: 2025 };
		expect(hasActiveFilter(state, "2026-09-18")).toBe(true);
	});

	it("reports an active filter once the year filter is cleared to 'any'", () => {
		const state = { ...initialFilterState("2026-09-18"), startYear: null };
		expect(hasActiveFilter(state, "2026-09-18")).toBe(true);
	});

	it("does not report the neutral baseline as the default state", () => {
		// 「清除筛选」后按钮应继续可见（已不是默认档），否则用户没法再回到默认视图
		expect(hasActiveFilter(defaultFilterState(), "2026-09-18")).toBe(true);
	});

	it("honours the '不限年度' preference from settings", () => {
		const state = initialFilterState("2026-09-18", "none");
		expect(state.startYear).toBeNull();
		// 在该档下「不限年度」本身就是默认，清除按钮不该出现
		expect(hasActiveFilter(state, "2026-09-18", "none")).toBe(false);
		// 反过来，选了具体年度就属于「已筛选」
		const picked = { ...state, startYear: 2025 };
		expect(hasActiveFilter(picked, "2026-09-18", "none")).toBe(true);
	});
});

describe("状态快捷档检测（chips ↔ 下拉的一致性）", () => {
	it("detects each preset round-trip", () => {
		expect(detectStatusPreset(presetToStatuses("hide-completed"))).toBe("hide-completed");
		expect(detectStatusPreset(presetToStatuses("completed-only"))).toBe("completed-only");
		expect(detectStatusPreset(presetToStatuses("all"))).toBe("all");
	});

	it("falls back to 'all' for an empty selection (no status filter)", () => {
		expect(detectStatusPreset([])).toBe("all");
	});

	it("toggles a chip on and off without reordering", () => {
		expect(toggle(["a", "b"], "c")).toEqual(["a", "b", "c"]);
		expect(toggle(["a", "b", "c"], "b")).toEqual(["a", "c"]);
	});
});
