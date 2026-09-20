import { describe, expect, it } from "vitest";
import { buildGanttModel } from "../src/gantt/gantt-model";
import { exportMermaid, parseExcludeDates, wrapInMarkers } from "../src/gantt/mermaid-export";
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

	it("combines all three directives in a stable order", () => {
		const output = exportOf([item], {
			mermaidTodayMarker: false,
			mermaidExcludeWeekends: true,
			mermaidExcludeDates: "2026-10-01",
		});
		expect(output).toContain(
			"    axisFormat %y-%m\n    todayMarker off\n    excludes weekends\n    excludes 2026-10-01\n\n",
		);
	});

	it("drops unparseable exclude dates instead of breaking the whole diagram", () => {
		// mermaid 的 excludes 只认 YYYY-MM-DD；传「10/1」会让整张图解析失败，宁可丢掉
		expect(parseExcludeDates("10/1, 2026-13-01, 2026-02-30, 2026-10-01")).toEqual([
			"2026-10-01",
		]);
	});

	it("dedupes exclude dates", () => {
		expect(parseExcludeDates("2026-10-01,2026-10-01")).toEqual(["2026-10-01"]);
	});
});

describe("Mermaid 导出 — 与视图折叠状态解耦（导出的是数据，不是当前视图）", () => {
	it("still exports projects inside a collapsed section", () => {
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
		const model = buildGanttModel([a, b], settings(), TODAY, {
			sections: [
				{ key: "k1", name: "官网", paths: [a.file.path], collapsed: true },
				{ key: "k2", name: "品牌", paths: [b.file.path], collapsed: false },
			],
		});
		const output = exportMermaid(model, settings());
		// 折叠不该让项目从导出里消失，否则用户折叠一下会以为项目丢了
		expect(output).toContain("a :active, a, 2026-01-01, 2026-01-02");
		expect(output).toContain("b :active, b, 2026-01-03, 2026-01-04");
		expect(output).toContain("    section 官网");
	});

	it("does not emit a section header just because a single section is collapsed", () => {
		const a = projectItem({ name: "a", startDate: "2026-01-01", dueDate: "2026-01-02" });
		const model = buildGanttModel([a], settings(), TODAY, {
			sections: [{ key: "k", name: "唯一分组", paths: [a.file.path], collapsed: true }],
		});
		// 图上要显示标题（用户得能展开），但导出仍严格对齐 projectGantt.js：单分节不出 section
		expect(model.showSectionHeaders).toBe(true);
		expect(exportMermaid(model, settings())).not.toContain("section");
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
