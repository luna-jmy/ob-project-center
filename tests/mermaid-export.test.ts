import { describe, expect, it } from "vitest";
import { buildGanttModel } from "../src/gantt/gantt-model";
import { exportableRows, exportMermaid, wrapInMarkers } from "../src/gantt/mermaid-export";
import { expandIsoDateSpecs } from "../src/services/holiday-schedule";
import { projectItem, settings } from "./fixtures";

const TODAY = "2026-09-18";

function exportOf(
	items: Parameters<typeof buildGanttModel>[0],
	overrides: Parameters<typeof settings>[0] = {},
): string {
	return exportMermaid(buildGanttModel(items, settings(overrides), TODAY), settings(overrides));
}

describe("Mermaid 导出 — 头部固定格式（SPEC F1.7，对齐 projectGantt.js）", () => {
	it("emits the exact fenced block header the existing script produces", () => {
		const output = exportOf([
			projectItem({
				name: "官网改版",
				startDate: "2026-01-01",
				dueDate: "2026-01-10",
				objective: "增长",
			}),
		]);
		expect(output).toBe(
			"```mermaid\n" +
				"gantt\n" +
				"    title 项目进度甘特图\n" +
				"    dateFormat YYYY-MM-DD\n" +
				"    axisFormat %y-%m\n" +
				"\n" +
				"    官网改版 :active, 官网改版, 2026-01-01, 2026-01-10\n" +
				"\n" +
				"```",
		);
	});

	it("omits the section header when there is a single section (script behavior)", () => {
		const output = exportOf([
			projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02", objective: "官网" }),
			projectItem({ name: "b", startDate: "2026-01-03", dueDate: "2026-01-04", objective: "官网" }),
		]);
		expect(output).not.toContain("section");
	});

	it("emits one section per objective when there are several", () => {
		const output = exportOf([
			projectItem({
				name: "官网改版",
				startDate: "2026-01-01",
				dueDate: "2026-01-10",
				objective: "增长",
				status: "active",
			}),
			projectItem({
				name: "品牌升级",
				startDate: "2026-02-01",
				dueDate: "2026-02-10",
				objective: "品牌",
				status: "completed",
			}),
		]);
		expect(output).toBe(
			"```mermaid\n" +
				"gantt\n" +
				"    title 项目进度甘特图\n" +
				"    dateFormat YYYY-MM-DD\n" +
				"    axisFormat %y-%m\n" +
				"\n" +
				"    section 增长\n" +
				"    官网改版 :active, 官网改版, 2026-01-01, 2026-01-10\n" +
				"\n" +
				"    section 品牌\n" +
				"    品牌升级 :done, 品牌升级, 2026-02-01, 2026-02-10\n" +
				"\n" +
				"```",
		);
	});

	it("honors a configurable title", () => {
		const output = exportOf(
			[projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02" })],
			{ mermaidTitle: "季度项目" },
		);
		expect(output).toContain("    title 季度项目\n");
	});
});

describe("Mermaid 导出 — 状态标记（脚本 done / active 约定）", () => {
	it("marks completed as done and active as active", () => {
		const output = exportOf(
			[
				projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02", status: "completed" }),
				projectItem({ name: "b", startDate: "2026-01-01", dueDate: "2026-01-02", status: "active" }),
			],
			{ hideCancelledInGantt: false },
		);
		expect(output).toContain("a :done, a, 2026-01-01, 2026-01-02");
		expect(output).toContain("b :active, b, 2026-01-01, 2026-01-02");
	});

	it("leaves other statuses unmarked", () => {
		const output = exportOf([
			projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02", status: "draft" }),
		]);
		expect(output).toContain("a :a, 2026-01-01, 2026-01-02");
	});
});

/*
 * 关键任务（用户口径 2026-09-20）：priority 1（最高）/ 2（高）→ mermaid 的 `crit`。
 * 锁两件事：档位边界（3 及以下不加），以及标签的位置（必须在冒号后最前面）。
 */
describe("Mermaid 导出 — 关键任务标记（priority 1/2 → crit）", () => {
	// 夹具默认 status 是 active（自带 active 标签），这里固定成无标签的 draft，
	// 好让断言只盯着 crit 这一件事
	it("marks priority 1 (最高) as critical", () => {
		const output = exportOf([
			projectItem({
				name: "a",
				startDate: "2026-01-01",
				dueDate: "2026-01-02",
				status: "draft",
				priority: "1",
			}),
		]);
		expect(output).toContain("a :crit, a, 2026-01-01, 2026-01-02");
	});

	it("marks priority 2 (高) as critical", () => {
		const output = exportOf([
			projectItem({
				name: "a",
				startDate: "2026-01-01",
				dueDate: "2026-01-02",
				status: "draft",
				priority: "2",
			}),
		]);
		expect(output).toContain("a :crit, a, 2026-01-01, 2026-01-02");
	});

	it("leaves priority 3 / empty / missing unmarked", () => {
		const output = exportOf([
			projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02", priority: "3" }),
			projectItem({ name: "b", startDate: "2026-01-01", dueDate: "2026-01-02", priority: "" }),
			projectItem({ name: "c", startDate: "2026-01-01", dueDate: "2026-01-02", priority: null }),
		]);
		expect(output).not.toContain("crit");
	});

	/*
	 * 标签必须写在冒号后的最前面、逗号分隔（mermaid 语法），
	 * 所以 crit 与状态标签共存时都要排在任务 ID 与日期之前。
	 */
	it("puts crit before the status tag and before the task id", () => {
		const output = exportOf([
			projectItem({
				name: "a",
				startDate: "2026-01-01",
				dueDate: "2026-01-02",
				priority: "1",
				status: "completed",
			}),
		]);
		expect(output).toContain("a :crit, done, a, 2026-01-01, 2026-01-02");
	});

	it("tolerates surrounding whitespace in the priority value", () => {
		const output = exportOf([
			projectItem({
				name: "a",
				startDate: "2026-01-01",
				dueDate: "2026-01-02",
				status: "draft",
				priority: " 2 ",
			}),
		]);
		expect(output).toContain("a :crit, a, 2026-01-01, 2026-01-02");
	});
});

describe("Mermaid 导出 — 任务名清洗与 ID 安全", () => {
	it("strips characters outside CJK and alphanumerics from the display name", () => {
		const output = exportOf([
			projectItem({ name: "项目 A (v2)!", startDate: "2026-01-01", dueDate: "2026-01-02" }),
		]);
		expect(output).toContain("项目 A (v2)! :active, 项目Av2, 2026-01-01, 2026-01-02");
	});

	it("dedupes IDs for same-named projects so mermaid does not break", () => {
		const output = exportOf([
			projectItem({
				name: "同名",
				path: "100 Projects/A/同名.md",
				startDate: "2026-01-01",
				dueDate: "2026-01-02",
			}),
			projectItem({
				name: "同名",
				path: "100 Projects/B/同名.md",
				startDate: "2026-01-03",
				dueDate: "2026-01-04",
			}),
		]);
		expect(output).toContain("同名 :active, 同名, 2026-01-01, 2026-01-02");
		expect(output).toContain("同名-2 :active, 同名, 2026-01-03, 2026-01-04");
	});

	it("falls back to the ID when cleaning leaves nothing", () => {
		const output = exportOf([
			projectItem({ name: "🚀🚀", startDate: "2026-01-01", dueDate: "2026-01-02" }),
		]);
		expect(output).toContain("🚀🚀 :active, 🚀🚀, 2026-01-01, 2026-01-02");
	});

	it("removes colons from IDs (colon separates id from task text in mermaid)", () => {
		const output = exportOf([
			projectItem({ name: "a:b", startDate: "2026-01-01", dueDate: "2026-01-02" }),
		]);
		expect(output).toContain("ab :active, ab, 2026-01-01, 2026-01-02");
	});
});

describe("Mermaid 导出 — 与渲染层共用兜底日期", () => {
	it("exports the resolved ±7 day range instead of raw missing dates", () => {
		const output = exportOf([
			projectItem({
				name: "只有截止",
				dueDate: "2026-02-10",
			}),
		]);
		expect(output).toContain("只有截止 :active, 只有截止, 2026-02-03, 2026-02-10");
	});

	it("skips cancelled projects by default (matches the rendered gantt)", () => {
		const output = exportOf([
			projectItem({
				name: "死了",
				startDate: "2026-01-01",
				dueDate: "2026-01-02",
				status: "cancelled",
			}),
		]);
		expect(output).not.toContain("死了");
		expect(output).toBe(
			"```mermaid\n" +
				"gantt\n" +
				"    title 项目进度甘特图\n" +
				"    dateFormat YYYY-MM-DD\n" +
				"    axisFormat %y-%m\n" +
				"\n" +
				"```",
		);
	});
});

describe("Mermaid 导出 — 选项指令（用户要求 2026-09-20）", () => {
	const item = projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02" });

	it("emits nothing extra with the defaults (stay byte-identical to projectGantt.js)", () => {
		const output = exportOf([item]);
		expect(output).toContain("    axisFormat %y-%m\n\n");
	});

	it("turns the today marker off only when the option is off", () => {
		expect(exportOf([item], { mermaidTodayMarker: false })).toContain("    todayMarker off\n");
		expect(exportOf([item], { mermaidTodayMarker: true })).not.toContain("todayMarker");
	});

	it("emits excludes weekends when asked", () => {
		expect(exportOf([item], { mermaidExcludeWeekends: true })).toContain(
			"    excludes weekends\n",
		);
	});

	it("emits an excludes list for extra dates", () => {
		const output = exportOf([item], {
			mermaidExcludeDates: "2026-10-01, 2026-10-02\n2026-10-03",
		});
		expect(output).toContain("    excludes 2026-10-01,2026-10-02,2026-10-03\n");
	});

	it("combines all four directives in a stable order", () => {
		const output = exportOf([item], {
			mermaidTodayMarker: false,
			mermaidExcludeWeekends: true,
			mermaidExcludeDates: "2026-10-01",
			mermaidIncludeDates: "2026-10-10",
		});
		expect(output).toContain(
			"    axisFormat %y-%m\n    todayMarker off\n    excludes weekends\n"
				+ "    excludes 2026-10-01\n    includes 2026-10-10\n\n",
		);
	});

	it("drops unparseable exclude dates instead of breaking the whole diagram", () => {
		// mermaid 的 excludes 只认 YYYY-MM-DD；传「10/1」会让整张图解析失败，宁可丢掉
		expect(expandIsoDateSpecs("10/1, 2026-13-01, 2026-02-30, 2026-10-01")).toEqual([
			"2026-10-01",
		]);
	});

	it("dedupes dates", () => {
		expect(expandIsoDateSpecs("2026-10-01,2026-10-01")).toEqual(["2026-10-01"]);
	});

	it("expands an ISO range instead of asking for every single day", () => {
		const output = exportOf([item], {
			mermaidExcludeDates: "2026-10-01~2026-10-03",
		});
		expect(output).toContain("    excludes 2026-10-01,2026-10-02,2026-10-03\n");
	});
});

/*
 * 年度排期表（用户要求 2026-09-20）：设置里按年份维护区间，导出时按图跨度自动套用。
 * 这里锁住「跨年取两年」「与面板输入合并」「不越界取无关年份」三条。
 */
describe("Mermaid 导出 — 年度法定节假日排期", () => {
	const scheduleFor = (year: string, holidays: string, makeup: string) => ({
		[year]: { holidays, makeupWorkdays: makeup },
	});

	it("applies the schedule of the year the chart spans", () => {
		const item = projectItem({ name: "a", startDate: "2026-09-28", dueDate: "2026-10-12" });
		const output = exportOf([item], {
			holidaySchedules: scheduleFor("2026", "10-01~10-07", "09-27, 10-10"),
		});
		expect(output).toContain(
			"    excludes 2026-10-01,2026-10-02,2026-10-03,2026-10-04,2026-10-05,2026-10-06,2026-10-07\n",
		);
		expect(output).toContain("    includes 2026-09-27,2026-10-10\n");
	});

	it("merges every year the chart crosses (跨年项目不会漏掉元旦)", () => {
		const item = projectItem({ name: "a", startDate: "2026-12-20", dueDate: "2027-01-10" });
		const output = exportOf([item], {
			holidaySchedules: {
				...scheduleFor("2026", "10-01~10-07", ""),
				...scheduleFor("2027", "01-01~01-03", ""),
			},
		});
		// 两年的日期合并成一行、升序：年内那些落在图范围之外的日期也照列不误
		// （它们是「生效中的假期」，mermaid 只在任务区间内画灰带，多列无害且便于核对）
		expect(output).toContain(
			"    excludes 2026-10-01,2026-10-02,2026-10-03,2026-10-04,2026-10-05,2026-10-06,"
				+ "2026-10-07,2027-01-01,2027-01-02,2027-01-03\n",
		);
	});

	it("ignores schedules of years the chart does not touch", () => {
		const item = projectItem({ name: "a", startDate: "2026-01-05", dueDate: "2026-01-09" });
		const output = exportOf([item], {
			holidaySchedules: scheduleFor("2030", "10-01~10-07", "09-27"),
		});
		expect(output).not.toContain("excludes 20");
		expect(output).not.toContain("includes");
	});

	it("merges the yearly schedule with the panel's ad-hoc dates", () => {
		const item = projectItem({ name: "a", startDate: "2026-09-28", dueDate: "2026-10-12" });
		const output = exportOf([item], {
			holidaySchedules: scheduleFor("2026", "10-01~10-02", ""),
			mermaidExcludeDates: "2026-10-05",
			mermaidIncludeDates: "2026-10-10",
		});
		// 两个来源合并后升序去重
		expect(output).toContain("    excludes 2026-10-01,2026-10-02,2026-10-05\n");
		expect(output).toContain("    includes 2026-10-10\n");
	});

	it("dedupes a date that appears in both the schedule and the panel input", () => {
		const item = projectItem({ name: "a", startDate: "2026-09-28", dueDate: "2026-10-12" });
		const output = exportOf([item], {
			holidaySchedules: scheduleFor("2026", "10-01", ""),
			mermaidExcludeDates: "2026-10-01",
		});
		expect(output).toContain("    excludes 2026-10-01\n");
	});
});

/*
 * 国内日历的两半：法定节假日走 excludes，调休补班走 includes（用户提问 2026-09-20）。
 *
 * 依据 mermaid 源码（gantt.jison 的 lexer + ganttDb.isInvalidDate + ganttRenderer.drawExcludeDays）：
 * `includes` 是**优先级最高**的工作日白名单，命中即 `return false`，盖过 excludes weekends
 * 与具体日期排除；渲染器把「被判为排除的日子」画成贯穿整图的灰色色带，
 * 所以被 includes 捞回来的补班日不会出现灰列。
 * 官方文档只写了 excludes，没写 includes——这两条测试锁住我们依赖的实际行为。
 */
describe("Mermaid 导出 — 法定节假日与调休补班", () => {
	const item = projectItem({ name: "a", startDate: "2026-09-28", dueDate: "2026-10-12" });

	const nationalDay = () =>
		exportOf([item], {
			mermaidExcludeWeekends: true,
			// 国庆：10-01 ~ 10-07 放假；09-27 与 10-10 是周末补班
			mermaidExcludeDates: "2026-10-01,2026-10-02,2026-10-03,2026-10-04,2026-10-05,2026-10-06,2026-10-07",
			mermaidIncludeDates: "2026-09-27, 2026-10-10",
		});

	it("emits the holidays as excludes and the make-up workdays as includes", () => {
		const output = nationalDay();
		expect(output).toContain("    excludes weekends\n");
		expect(output).toContain(
			"    excludes 2026-10-01,2026-10-02,2026-10-03,2026-10-04,2026-10-05,2026-10-06,2026-10-07\n",
		);
		expect(output).toContain("    includes 2026-09-27,2026-10-10\n");
	});

	it("puts includes after excludes (order is what makes the override readable)", () => {
		const output = nationalDay();
		const excludesAt = output.indexOf("    excludes 2026-10-01");
		const includesAt = output.indexOf("    includes 2026-09-27");
		expect(excludesAt).toBeGreaterThan(-1);
		expect(includesAt).toBeGreaterThan(excludesAt);
	});

	it("omits the includes line when the field is empty", () => {
		expect(exportOf([item], { mermaidIncludeDates: "" })).not.toContain("includes");
		// 全是非法写法时也不该输出空指令
		expect(exportOf([item], { mermaidIncludeDates: "10/10, 调休" })).not.toContain("includes");
	});

	it("keeps the two lists independent (同一日期两边都写了也不会串)", () => {
		const output = exportOf([item], {
			mermaidExcludeDates: "2026-10-01",
			mermaidIncludeDates: "2026-10-01",
		});
		// 原样透传：谁覆盖谁由 mermaid 的 isInvalidDate 优先级决定（includes 赢），
		// 插件不替用户做这个判断，免得两处口径打架
		expect(output).toContain("    excludes 2026-10-01\n");
		expect(output).toContain("    includes 2026-10-01\n");
	});
});

/*
 * 折叠 = 不要它（用户口径 2026-09-20 修订）。
 *
 * 早期实现是「导出的是数据，不是当前视图」，折叠分节照导；用起来才发现是反的：
 * 用户折叠分节就是为了把不关心的部分收起来，导出（尤其「写入笔记」）又写回去
 * 等于白折叠。现在导出严格跟随可见内容。
 */
describe("Mermaid 导出 — 跟随视图折叠状态", () => {
	const a = projectItem({
		name: "a",
		startDate: "2026-01-01",
		dueDate: "2026-01-02",
		objective: "官网",
	});
	const b = projectItem({
		name: "b",
		startDate: "2026-01-03",
		dueDate: "2026-01-04",
		objective: "品牌",
	});
	const c = projectItem({
		name: "c",
		startDate: "2026-01-05",
		dueDate: "2026-01-06",
		objective: "渠道",
	});

	// 分节描述必须覆盖传进去的每一个项目：没被认领的会落进兜底分节（未折叠），
	// 那会让「只留一个可见分节」这类断言失真
	const modelOf = (
		items: Parameters<typeof buildGanttModel>[0],
		sections: { key: string; name: string; paths: string[]; collapsed: boolean }[],
	) => buildGanttModel(items, settings(), TODAY, { sections });

	it("skips a collapsed section entirely: no rows, no section header", () => {
		const model = modelOf([a, b], [
			{ key: "k1", name: "官网", paths: [a.file.path], collapsed: true },
			{ key: "k2", name: "品牌", paths: [b.file.path], collapsed: false },
		]);
		const output = exportMermaid(model, settings());
		expect(output).not.toContain("a :");
		expect(output).not.toContain("section 官网");
		expect(output).toContain("b :active, b, 2026-01-03, 2026-01-04");
	});

	it("counts section headers over the visible sections only", () => {
		// 折叠掉一个之后只剩两个可见 → 仍然出 section 行（多分节口径）
		const output = exportMermaid(
			modelOf([a, b, c], [
				{ key: "k1", name: "官网", paths: [a.file.path], collapsed: false },
				{ key: "k2", name: "品牌", paths: [b.file.path], collapsed: true },
				{ key: "k3", name: "渠道", paths: [c.file.path], collapsed: false },
			]),
			settings(),
		);
		expect(output).toContain("    section 官网");
		expect(output).toContain("    section 渠道");
		expect(output).not.toContain("section 品牌");
	});

	it("omits the section header when collapsing leaves a single visible section", () => {
		const model = modelOf([a, b], [
			{ key: "k1", name: "官网", paths: [a.file.path], collapsed: false },
			{ key: "k2", name: "品牌", paths: [b.file.path], collapsed: true },
		]);
		const output = exportMermaid(model, settings());
		// 图上仍要显示分节头（用户得能展开），但导出严格对齐 projectGantt.js：单节不出 section
		expect(model.showSectionHeaders).toBe(true);
		expect(output).not.toContain("section");
		expect(output).toContain("a :active, a, 2026-01-01, 2026-01-02");
	});

	it("exports an empty chart when everything is collapsed", () => {
		const output = exportMermaid(
			modelOf([a, b], [
				{ key: "k1", name: "官网", paths: [a.file.path], collapsed: true },
				{ key: "k2", name: "品牌", paths: [b.file.path], collapsed: true },
			]),
			settings(),
		);
		expect(output).toContain("    axisFormat %y-%m\n\n");
		expect(output).not.toContain("section");
		expect(output).not.toContain(" :active");
	});

	it("reports the exportable rows so callers count what actually goes out", () => {
		const model = modelOf([a, b, c], [
			{ key: "k1", name: "官网", paths: [a.file.path], collapsed: true },
			{ key: "k2", name: "品牌", paths: [b.file.path], collapsed: false },
			{ key: "k3", name: "渠道", paths: [c.file.path], collapsed: false },
		]);
		expect(exportableRows(model).map((row) => row.item.file.name)).toEqual(["b", "c"]);
		expect(exportableRows(null)).toEqual([]);
	});
});

describe("Mermaid 导出 — 写入笔记的落点标记（SPEC F1.7 增强项）", () => {
	it("wraps the block in the configurable gantt-builder markers", () => {
		const wrapped = wrapInMarkers("```mermaid\ngantt\n```", settings());
		expect(wrapped).toBe(
			"%% gantt-builder:start %%\n\n```mermaid\ngantt\n```\n\n%% gantt-builder:end %%",
		);
	});

	it("uses custom markers when configured", () => {
		const wrapped = wrapInMarkers(
			"X",
			settings({ mermaidMarkerStart: "<!--s-->", mermaidMarkerEnd: "<!--e-->" }),
		);
		expect(wrapped).toBe("<!--s-->\n\nX\n\n<!--e-->");
	});
});
