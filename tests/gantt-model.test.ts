import { describe, expect, it } from "vitest";
import { buildGanttModel, durationLabel, rowIndexOf } from "../src/gantt/gantt-model";
import { PROJECT_STATUSES } from "../src/types";
import { projectItem, settings } from "./fixtures";

const TODAY = "2026-09-18";

/*
 * 非工作日（2026-09-20）：自绘甘特图要自己把周末/节假日画成灰色列。
 * mermaid 那边的 excludes 只能画底带且画在任务条后面，靠它用户验收不了「排除周末」。
 * 口径由 services/holiday-schedule.ts 统一给出，这里只锁「模型有没有正确带出来」。
 */
/*
 * 条上显示天数（用户要求 2026-09-20）。
 * 「工作日」不是另立一套日历，而是复用非工作日清单（周末开关 + 节假日排期 − 补班日），
 * 也就是导出 mermaid 用的那一份——图和导出因此不会各说各话。
 */
/*
 * 长期项目不上甘特图（用户口径 2026-09-20）：这是**硬规则**，不看有没有日期。
 *
 * 之前只在筛选层豁免了长期项目（让它别被年度筛选挡掉），结果它带着日期照样上了图——
 * 一条「从某天到某天」的条子等于替它编造了一个它并不具备的时间承诺。
 */
describe("甘特模型 — 长期项目不上图", () => {
	it("skips a long-term project even when it has a full date range", () => {
		const model = buildGanttModel(
			[
				projectItem({
					name: "长期",
					startDate: "2026-01-01",
					dueDate: "2026-12-31",
					longTerm: true,
				}),
				projectItem({ name: "普通", startDate: "2026-09-01", dueDate: "2026-09-10" }),
			],
			settings(),
			TODAY,
		);
		expect(model.rows.map((row) => row.item.file.name)).toEqual(["普通"]);
		expect(model.skipped.map((skip) => skip.reason)).toEqual(["long-term"]);
		expect(model.skipped[0]?.item.file.name).toBe("长期");
	});

	it("reports 长期项目 as the reason even when the project is also cancelled", () => {
		const model = buildGanttModel(
			[
				projectItem({
					name: "长期且取消",
					startDate: "2026-01-01",
					dueDate: "2026-12-31",
					longTerm: true,
					status: "cancelled",
				}),
			],
			settings(),
			TODAY,
		);
		expect(model.rows).toHaveLength(0);
		expect(model.skipped[0]?.reason).toBe("long-term");
	});
});

describe("甘特模型 — bar 上的天数（自然日 / 工作日）", () => {
	// 2026-09-14(一) ~ 09-20(日)：共 7 天，其中 09-19、09-20 是周末 → 工作日 5 天
	const week = [projectItem({ name: "a", startDate: "2026-09-14", dueDate: "2026-09-20" })];

	it("counts calendar days as a closed interval", () => {
		const row = buildGanttModel(week, settings({ ganttBarDuration: "calendar" }), TODAY).rows[0];
		expect(row?.calendarDays).toBe(7);
		expect(row?.durationLabel).toBe("7天");
	});

	it("subtracts weekends only when the weekend option is on", () => {
		const withWeekend = buildGanttModel(
			week,
			settings({ ganttBarDuration: "workday", mermaidExcludeWeekends: true }),
			TODAY,
		).rows[0];
		expect(withWeekend?.workdayDays).toBe(5);
		expect(withWeekend?.durationLabel).toBe("5工作日");

		// 没开「排除周末」时，工作日就等于自然日——口径一致，不偷偷替用户决定
		const withoutWeekend = buildGanttModel(
			week,
			settings({ ganttBarDuration: "workday" }),
			TODAY,
		).rows[0];
		expect(withoutWeekend?.workdayDays).toBe(7);
	});

	it("subtracts holidays and credits make-up workdays", () => {
		const row = buildGanttModel(
			week,
			settings({
				ganttBarDuration: "workday",
				mermaidExcludeWeekends: true,
				holidaySchedules: { "2026": { holidays: "09-16~09-17", makeupWorkdays: "09-20" } },
			}),
			TODAY,
		).rows[0];
		// 7 天 − 09-19(六) − 09-20(日，但补班) − 09-16 − 09-17 = 4
		expect(row?.workdayDays).toBe(4);
		expect(row?.calendarDays).toBe(7);
	});

	it("still computes both counts when the label is off (bar 悬停提示要用)", () => {
		const row = buildGanttModel(week, settings(), TODAY).rows[0];
		expect(row?.durationLabel).toBeNull();
		expect(row?.calendarDays).toBe(7);
		expect(row?.workdayDays).toBe(7);
	});

	it("keeps the single-day case honest (闭区间：一天就是 1，不是 0)", () => {
		const row = buildGanttModel(
			[projectItem({ name: "one", startDate: "2026-09-16", dueDate: "2026-09-16" })],
			settings({ ganttBarDuration: "calendar" }),
			TODAY,
		).rows[0];
		expect(row?.durationLabel).toBe("1天");
	});

	it("labels every mode through one pure helper", () => {
		expect(durationLabel("off", 10, 7)).toBeNull();
		expect(durationLabel("calendar", 10, 7)).toBe("10天");
		expect(durationLabel("workday", 10, 7)).toBe("7工作日");
	});
});

describe("甘特模型 — 非工作日清单", () => {
	const week = [projectItem({ name: "a", startDate: "2026-09-14", dueDate: "2026-09-20" })];

	it("is empty when neither weekends nor holidays are configured", () => {
		expect(buildGanttModel(week, settings(), TODAY).nonWorkingDays).toEqual([]);
	});

	it("expands weekends across the model range when the option is on", () => {
		const model = buildGanttModel(week, settings({ mermaidExcludeWeekends: true }), TODAY);
		// 09-14(一) ~ 09-20(日) → 只有 09-19、09-20 是周末
		expect(model.nonWorkingDays).toEqual(["2026-09-19", "2026-09-20"]);
	});

	it("adds schedule holidays and lets a make-up workday cancel a weekend", () => {
		const model = buildGanttModel(
			week,
			settings({
				mermaidExcludeWeekends: true,
				holidaySchedules: {
					"2026": { holidays: "09-16~09-17", makeupWorkdays: "09-20" },
				},
			}),
			TODAY,
		);
		// 09-16、09-17 是节假日；09-19 周六仍是周末；09-20 周日被补班捞回工作日
		expect(model.nonWorkingDays).toEqual(["2026-09-16", "2026-09-17", "2026-09-19"]);
	});
});

describe("甘特模型 — 日期兜底（SPEC §2.3，继承 projectGantt.js ±7 天）", () => {
	it("keeps both dates as-is when present", () => {
		const model = buildGanttModel(
			[projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-02-01" })],
			settings(),
			TODAY,
		);
		const row = model.rows[0];
		expect(row?.start).toBe("2026-01-01");
		expect(row?.end).toBe("2026-02-01");
		expect(row?.startFallback).toBe(false);
		expect(row?.endFallback).toBe(false);
	});

	it("derives start from end minus fallback days", () => {
		const model = buildGanttModel(
			[projectItem({ name: "a", dueDate: "2026-02-10" })],
			settings(),
			TODAY,
		);
		expect(model.rows[0]?.start).toBe("2026-02-03");
		expect(model.rows[0]?.end).toBe("2026-02-10");
		expect(model.rows[0]?.startFallback).toBe(true);
		expect(model.rows[0]?.endFallback).toBe(false);
	});

	it("derives end from start plus fallback days (crossing month boundary)", () => {
		const model = buildGanttModel(
			[projectItem({ name: "a", startDate: "2026-02-25" })],
			settings(),
			TODAY,
		);
		expect(model.rows[0]?.end).toBe("2026-03-04");
		expect(model.rows[0]?.endFallback).toBe(true);
	});

	it("honors the configured fallback day count instead of hardcoding 7", () => {
		const model = buildGanttModel(
			[projectItem({ name: "a", dueDate: "2026-02-10" })],
			settings({ dateFallbackDays: 3 }),
			TODAY,
		);
		expect(model.rows[0]?.start).toBe("2026-02-07");
	});

	it("excludes dateless projects (script requires at least one date)", () => {
		const model = buildGanttModel([projectItem({ name: "a" })], settings(), TODAY);
		expect(model.rows).toHaveLength(0);
		expect(model.skipped[0]?.reason).toBe("no-dates");
	});

	it("mark-invalid strategy refuses to synthesize dates", () => {
		const model = buildGanttModel(
			[projectItem({ name: "a", dueDate: "2026-02-10" })],
			settings({ dateFallback: "mark-invalid" }),
			TODAY,
		);
		expect(model.rows).toHaveLength(0);
		expect(model.skipped[0]?.reason).toBe("no-dates");
	});

	it("mark-invalid still renders projects that have both dates", () => {
		const model = buildGanttModel(
			[projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-09" })],
			settings({ dateFallback: "mark-invalid" }),
			TODAY,
		);
		expect(model.rows).toHaveLength(1);
	});
});

/*
 * 状态与上图（2026-09-21）：**任何状态都不再被跳过**，取消的项目照常出现在甘特图上。
 *
 * 历史背景：SPEC F1.6 曾让「cancelled 默认排除」（继承旧脚本，由设置开关控制），
 * 结果用户把项目改成取消后它就从图上消失，还找不到原因——而状态筛选里本来就有
 * 「取消」这个可选项，要不要显示它应该只有一个开关。这条测试固定住新口径。
 */
describe("甘特模型 — 状态不影响上图", () => {
	it("renders every status, cancelled included", () => {
		const model = buildGanttModel(
			PROJECT_STATUSES.map((status) =>
				projectItem({
					name: status,
					startDate: "2026-01-01",
					dueDate: "2026-01-05",
					status,
				}),
			),
			settings(),
			TODAY,
		);
		expect(model.rows).toHaveLength(PROJECT_STATUSES.length);
		expect(model.skipped).toEqual([]);
	});
});

describe("甘特模型 — 分节与范围（SPEC F1.1）", () => {
	it("groups rows by objective and only shows headers when there are several sections", () => {
		const model = buildGanttModel(
			[
				projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02", objective: "官网" }),
				projectItem({ name: "b", startDate: "2026-01-03", dueDate: "2026-01-04", objective: "官网" }),
				projectItem({ name: "c", startDate: "2026-01-05", dueDate: "2026-01-06", objective: "出海" }),
			],
			settings(),
			TODAY,
		);
		expect(model.showSectionHeaders).toBe(true);
		expect(model.sections.map((s) => s.name)).toEqual(["官网", "出海"]);
		expect(model.sections[0]?.rows).toHaveLength(2);
	});

	it("puts objective-less projects into the configurable fallback section", () => {
		const model = buildGanttModel(
			[
				projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02" }),
				projectItem({ name: "b", startDate: "2026-01-03", dueDate: "2026-01-04", objective: "官网" }),
			],
			settings(),
			TODAY,
		);
		expect(model.sections[0]?.name).toBe("默认项目");
	});

	it("hides section headers when every row shares one section", () => {
		const model = buildGanttModel(
			[
				projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02", objective: "官网" }),
				projectItem({ name: "b", startDate: "2026-01-03", dueDate: "2026-01-04", objective: "官网" }),
			],
			settings(),
			TODAY,
		);
		expect(model.sections).toHaveLength(1);
		expect(model.showSectionHeaders).toBe(false);
	});

	it("shows headers for a single section when the caller asks (value grouping)", () => {
		const items = [
			projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02" }),
			projectItem({ name: "b", startDate: "2026-01-03", dueDate: "2026-01-04" }),
		];
		const sections = [
			{ key: "市场", name: "市场", paths: items.map((i) => i.file.path), collapsed: false },
		];
		// 默认口径不变：单分节时标题看着多余（folder 模式一分节一项目的遗留决定）
		const silent = buildGanttModel(items, settings(), TODAY, { sections });
		expect(silent.showSectionHeaders).toBe(false);

		/*
		 * 值分组（目标 / 领域）例外：标题就是信息本身，而且左面板一直显示它——
		 * 甘特藏掉就成了「面板分组了、甘特没分组」（用户口径 2026-09-21）。
		 */
		const labelled = buildGanttModel(items, settings(), TODAY, {
			sections,
			showSectionHeaders: true,
		});
		expect(labelled.showSectionHeaders).toBe(true);
		expect(labelled.sections.map((s) => s.name)).toEqual(["市场"]);
	});

	it("computes the axis range across all bars", () => {
		const model = buildGanttModel(
			[
				projectItem({ name: "a", startDate: "2026-03-01", dueDate: "2026-03-10" }),
				projectItem({ name: "b", startDate: "2026-01-05", dueDate: "2026-12-31" }),
			],
			settings(),
			TODAY,
		);
		expect(model.rangeStart).toBe("2026-01-05");
		expect(model.rangeEnd).toBe("2026-12-31");
	});

	it("returns an empty model with a usable range when nothing is renderable", () => {
		const model = buildGanttModel([], settings(), TODAY);
		expect(model.rows).toHaveLength(0);
		expect(model.sections).toHaveLength(0);
		expect(model.rangeStart).toBe(TODAY);
		expect(model.rangeEnd).toBe(TODAY);
	});

	it("preserves the incoming order (pipeline owns sorting)", () => {
		const model = buildGanttModel(
			[
				projectItem({ name: "z", startDate: "2026-01-01", dueDate: "2026-01-02" }),
				projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02" }),
			],
			settings(),
			TODAY,
		);
		expect(model.rows.map((r) => r.item.file.name)).toEqual(["z", "a"]);
	});

	it("maps a path back to its flat row index for group-panel linkage (F3.4)", () => {
		const model = buildGanttModel(
			[
				projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02" }),
				projectItem({ name: "b", startDate: "2026-01-01", dueDate: "2026-01-02" }),
			],
			settings(),
			TODAY,
		);
		expect(rowIndexOf(model, "100 Projects/b.md")).toBe(1);
		expect(rowIndexOf(model, "100 Projects/missing.md")).toBe(-1);
	});
});

describe("甘特模型 — 外部分节（左右联动的地基）", () => {
	const items = [
		projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02" }),
		projectItem({ name: "b", startDate: "2026-01-03", dueDate: "2026-01-04" }),
	];

	it("takes section membership and order from the supplied specs, not from objective", () => {
		const model = buildGanttModel(items, settings(), TODAY, {
			sections: [
				{ key: "G", name: "G 组", paths: ["100 Projects/b.md"], collapsed: false },
				{ key: "H", name: "H 组", paths: ["100 Projects/a.md"], collapsed: false },
			],
		});
		expect(model.sections.map((s) => s.name)).toEqual(["G 组", "H 组"]);
		expect(model.sections.map((s) => s.key)).toEqual(["G", "H"]);
		// 分节顺序听外部的，行也跟着换位
		expect(model.sections[0]?.rows.map((r) => r.item.file.name)).toEqual(["b"]);
	});

	it("drops a spec whose projects are all unrenderable (no empty heading on the chart)", () => {
		const model = buildGanttModel(
			[
				...items,
				// 用「缺日期」制造不可渲染的条目（2026-09-21 起 cancelled 不再被跳过，见上）
				projectItem({ name: "dead" }),
			],
			settings(),
			TODAY,
			{
				sections: [
					{ key: "DEAD", name: "全被筛掉", paths: ["100 Projects/dead.md"], collapsed: false },
					{
						key: "G",
						name: "G 组",
						paths: ["100 Projects/a.md", "100 Projects/b.md"],
						collapsed: false,
					},
				],
			},
		);
		expect(model.sections.map((s) => s.key)).toEqual(["G"]);
	});

	it("keeps unclaimed rows in a trailing fallback section instead of losing them", () => {
		const model = buildGanttModel(items, settings(), TODAY, {
			sections: [{ key: "G", name: "G 组", paths: ["100 Projects/a.md"], collapsed: false }],
		});
		expect(model.sections).toHaveLength(2);
		expect(model.sections[1]?.rows.map((r) => r.item.file.name)).toEqual(["b"]);
		expect(model.sections[1]?.name).toBe("默认项目");
	});

	it("marks collapsed sections and keeps their rows in the model (export unaffected)", () => {
		const model = buildGanttModel(items, settings(), TODAY, {
			sections: [
				{ key: "G", name: "G 组", paths: ["100 Projects/a.md"], collapsed: true },
				{ key: "H", name: "H 组", paths: ["100 Projects/b.md"], collapsed: false },
			],
		});
		expect(model.sections[0]?.collapsed).toBe(true);
		// 行仍在模型里——折叠只是渲染层不占行高
		expect(model.rows).toHaveLength(2);
		expect(model.sections[0]?.rows).toHaveLength(1);
	});

	it("shows section headers when something is collapsed, even with a single section", () => {
		const single = buildGanttModel(items, settings(), TODAY, {
			sections: [
				{ key: "G", name: "G 组", paths: items.map((i) => i.file.path), collapsed: true },
			],
		});
		// 折叠时必须有标题，否则行消失后用户不知道去哪展开
		expect(single.showSectionHeaders).toBe(true);
	});

	it("widens the axis to cover the axisRange when it is larger than the projects", () => {
		const model = buildGanttModel(
			[projectItem({ name: "a", startDate: "2026-03-10", dueDate: "2026-03-20" })],
			settings(),
			TODAY,
			{ axisRange: { start: "2026-03-01", end: "2026-03-31" } },
		);
		// 筛选栏选了「本月」，时间轴就该铺满整月，而不是只画项目那几天
		expect(model.rangeStart).toBe("2026-03-01");
		expect(model.rangeEnd).toBe("2026-03-31");
	});

	it("keeps the projects' own range when it exceeds the axisRange", () => {
		const model = buildGanttModel(
			[projectItem({ name: "a", startDate: "2025-01-01", dueDate: "2027-12-31" })],
			settings(),
			TODAY,
			{ axisRange: { start: "2026-03-01", end: "2026-03-31" } },
		);
		expect(model.rangeStart).toBe("2025-01-01");
		expect(model.rangeEnd).toBe("2027-12-31");
	});

	it("falls back to objective sections when no specs are supplied", () => {
		const model = buildGanttModel(
			[projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02", objective: "官网" })],
			settings(),
			TODAY,
		);
		expect(model.sections[0]?.name).toBe("官网");
		expect(model.sections[0]?.key).toBe("objective:官网");
	});
});
