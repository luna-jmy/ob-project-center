import { describe, expect, it } from "vitest";
import {
	collectHolidayDates,
	expandIsoDateSpecs,
	expandYearSchedule,
	expandYearSpecs,
	mergeContiguousDays,
	nextScheduleYear,
	resolveHolidayDates,
	resolveNonWorkingDays,
	sortedScheduleYears,
	weekendDaysInRange,
} from "../src/services/holiday-schedule";
import { DEFAULT_SETTINGS, HolidayScheduleMap, ProjectMasterSettings } from "../src/types";

const settings = (overrides: Partial<ProjectMasterSettings> = {}): ProjectMasterSettings => ({
	...DEFAULT_SETTINGS,
	...overrides,
});

/*
 * 年度法定节假日排期（用户要求 2026-09-20）。
 *
 * 用户的原话是「我要排除 10 月 1-7 号，要把每一天都写一遍吗」——所以这里的核心
 * 不是「能不能解析」，而是**区间写法**与**按年份补全**，以及两者的边界（跨年、非法日期）。
 */

describe("日期清单展开 — 完整 ISO（面板上的临时补充）", () => {
	it("accepts a single date", () => {
		expect(expandIsoDateSpecs("2026-10-01")).toEqual(["2026-10-01"]);
	});

	it("expands an inclusive range written with ~", () => {
		expect(expandIsoDateSpecs("2026-10-01~2026-10-03")).toEqual([
			"2026-10-01",
			"2026-10-02",
			"2026-10-03",
		]);
	});

	it("also accepts the full-width tilde and the Chinese 至", () => {
		expect(expandIsoDateSpecs("2026-10-01～2026-10-02")).toEqual([
			"2026-10-01",
			"2026-10-02",
		]);
		expect(expandIsoDateSpecs("2026-10-01 至 2026-10-02")).toEqual([
			"2026-10-01",
			"2026-10-02",
		]);
	});

	it("mixes ranges and single dates, deduped and ascending", () => {
		expect(expandIsoDateSpecs("2026-10-03~2026-10-04, 2026-10-01, 2026-10-04")).toEqual([
			"2026-10-01",
			"2026-10-03",
			"2026-10-04",
		]);
	});

	it("drops anything mermaid would choke on", () => {
		// 年月日缩写、不存在的日期、反向区间一律丢掉，绝不让它们进导出
		expect(expandIsoDateSpecs("10-01, 2026-13-01, 2026-02-30, 2026-10-05~2026-10-01")).toEqual(
			[],
		);
	});

	it("does not infer a year (that is what the yearly schedule is for)", () => {
		expect(expandIsoDateSpecs("10-01~10-07")).toEqual([]);
	});
});

describe("日期清单展开 — 年度排期（MM-DD 按年补全）", () => {
	it("expands a month-day range inside the given year", () => {
		expect(expandYearSpecs("10-01~10-07", 2026)).toHaveLength(7);
		expect(expandYearSpecs("10-01~10-07", 2026)[0]).toBe("2026-10-01");
		expect(expandYearSpecs("10-01~10-07", 2026)[6]).toBe("2026-10-07");
	});

	it("accepts bare month-day and full ISO dates in the same list", () => {
		expect(expandYearSpecs("01-01, 2026-05-01", 2026)).toEqual(["2026-01-01", "2026-05-01"]);
	});

	it("rolls a cross-year range into the next year (元旦跨年)", () => {
		// 12-30~01-02 是最常见的跨年写法：终点早于起点 → 算到次年
		expect(expandYearSpecs("12-30~01-02", 2026)).toEqual([
			"2026-12-30",
			"2026-12-31",
			"2027-01-01",
			"2027-01-02",
		]);
	});

	it("rejects impossible month-day pairs for the given year", () => {
		expect(expandYearSpecs("02-30, 13-01, 00-05", 2026)).toEqual([]);
		// 2026 不是闰年，02-29 不存在；2028 是闰年，同一条写法要能通过
		expect(expandYearSpecs("02-29", 2026)).toEqual([]);
		expect(expandYearSpecs("02-29", 2028)).toEqual(["2028-02-29"]);
	});

	it("caps a runaway range so a typo cannot blow up the export", () => {
		// 起点误写到下个世纪时，最多也只展开 367 天
		expect(expandYearSpecs("01-01~2099-01-01", 2026).length).toBeLessThanOrEqual(367);
	});
});

describe("年度排期 → 具体日期", () => {
	it("splits holidays and makeup workdays", () => {
		const expanded = expandYearSchedule(2026, {
			holidays: "10-01~10-02",
			makeupWorkdays: "09-27",
		});
		expect(expanded.exclude).toEqual(["2026-10-01", "2026-10-02"]);
		expect(expanded.include).toEqual(["2026-09-27"]);
	});

	it("tolerates an empty schedule", () => {
		expect(expandYearSchedule(2026, { holidays: "", makeupWorkdays: "" })).toEqual({
			exclude: [],
			include: [],
		});
	});
});

describe("按图跨度合并年度排期", () => {
	const schedules: HolidayScheduleMap = {
		"2026": { holidays: "10-01~10-03", makeupWorkdays: "09-27" },
		"2027": { holidays: "01-01~01-02", makeupWorkdays: "01-09" },
	};

	it("takes only the years the range touches", () => {
		const result = collectHolidayDates("2026-09-01", "2026-12-31", schedules);
		expect(result.exclude).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
		expect(result.include).toEqual(["2026-09-27"]);
	});

	it("merges both years when the range crosses the new year boundary", () => {
		const result = collectHolidayDates("2026-12-20", "2027-02-01", schedules);
		expect(result.exclude).toContain("2026-10-01");
		expect(result.exclude).toContain("2027-01-01");
		expect(result.include).toEqual(["2026-09-27", "2027-01-09"]);
	});

	it("normalizes a reversed range", () => {
		expect(collectHolidayDates("2027-02-01", "2026-12-20", schedules).exclude).toContain(
			"2027-01-01",
		);
	});

	it("returns empty lists for years without a schedule", () => {
		expect(collectHolidayDates("2030-01-01", "2030-12-31", schedules)).toEqual({
			exclude: [],
			include: [],
		});
	});

	it("dedupes overlapping years' entries", () => {
		const overlapping: HolidayScheduleMap = {
			"2026": { holidays: "12-31~12-31", makeupWorkdays: "" },
			"2027": { holidays: "2026-12-31", makeupWorkdays: "" },
		};
		expect(collectHolidayDates("2026-12-01", "2027-01-31", overlapping).exclude).toEqual([
			"2026-12-31",
		]);
	});
});

/*
 * 自绘甘特图与 Mermaid 导出共用同一份「非工作日」口径（2026-09-20）。
 * 之所以要有这一层：用户点「排除周末」时，图上必须真的看得见东西——
 * 而 mermaid 的 excludes 只能画底带、还画在任务条后面，靠它不足以验收。
 */
describe("非工作日口径 — 两个渲染器共用", () => {
	// 2026-09-19 是周六、09-20 是周日
	const WEEK = { start: "2026-09-18", end: "2026-09-21" };

	it("finds the weekend days inside a range", () => {
		expect(weekendDaysInRange(WEEK.start, WEEK.end)).toEqual(["2026-09-19", "2026-09-20"]);
	});

	it("normalizes a reversed range", () => {
		expect(weekendDaysInRange(WEEK.end, WEEK.start)).toEqual(["2026-09-19", "2026-09-20"]);
	});

	it("merges the yearly schedule with the panel's ad-hoc dates", () => {
		const result = resolveHolidayDates(
			"2026-09-28",
			"2026-10-12",
			settings({
				holidaySchedules: { "2026": { holidays: "10-01~10-02", makeupWorkdays: "" } },
				mermaidExcludeDates: "2026-10-05",
				mermaidIncludeDates: "2026-10-10",
			}),
		);
		expect(result.exclude).toEqual(["2026-10-01", "2026-10-02", "2026-10-05"]);
		expect(result.include).toEqual(["2026-10-10"]);
	});

	it("has no non-working days when nothing is configured", () => {
		expect(resolveNonWorkingDays(WEEK.start, WEEK.end, settings())).toEqual([]);
	});

	it("adds weekends only when the option is on", () => {
		expect(
			resolveNonWorkingDays(WEEK.start, WEEK.end, settings({ mermaidExcludeWeekends: true })),
		).toEqual(["2026-09-19", "2026-09-20"]);
	});

	it("lets a make-up workday cancel a weekend day (补班优先)", () => {
		const days = resolveNonWorkingDays(
			WEEK.start,
			WEEK.end,
			settings({
				mermaidExcludeWeekends: true,
				holidaySchedules: {
					"2026": { holidays: "09-21~09-22", makeupWorkdays: "09-19" },
				},
			}),
		);
		// 09-19（周六）被补班捞回工作日；09-21~09-22 是节假日照算
		expect(days).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
	});

	it("merges contiguous days into ranges so the renderer draws few rects", () => {
		expect(
			mergeContiguousDays([
				"2026-09-19",
				"2026-09-20",
				"2026-09-26",
				"2026-10-01",
				"2026-10-02",
				"2026-10-03",
			]),
		).toEqual([
			{ start: "2026-09-19", end: "2026-09-20" },
			{ start: "2026-09-26", end: "2026-09-26" },
			{ start: "2026-10-01", end: "2026-10-03" },
		]);
	});

	it("returns no ranges for an empty list", () => {
		expect(mergeContiguousDays([])).toEqual([]);
	});
});

describe("设置页辅助", () => {
	it("lists the years in ascending order", () => {
		expect(sortedScheduleYears({ "2027": { holidays: "", makeupWorkdays: "" }, "2026": { holidays: "", makeupWorkdays: "" } })).toEqual([
			"2026",
			"2027",
		]);
	});

	it("suggests the current year when there is no schedule yet", () => {
		expect(nextScheduleYear({}, "2026-09-20")).toBe("2026");
	});

	it("suggests the year after the latest one", () => {
		const schedules: HolidayScheduleMap = {
			"2026": { holidays: "", makeupWorkdays: "" },
			"2027": { holidays: "", makeupWorkdays: "" },
		};
		expect(nextScheduleYear(schedules, "2026-09-20")).toBe("2028");
	});
});
