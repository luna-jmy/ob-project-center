import { describe, expect, it } from "vitest";
import { buildGanttModel, rowIndexOf } from "../src/gantt/gantt-model";
import { projectItem, settings } from "./fixtures";

const TODAY = "2026-09-18";

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

describe("甘特模型 — cancelled 排除（SPEC F1.6，现有规则）", () => {
	const items = [
		projectItem({
			name: "live",
			startDate: "2026-01-01",
			dueDate: "2026-01-05",
			status: "active",
		}),
		projectItem({
			name: "dead",
			startDate: "2026-01-01",
			dueDate: "2026-01-05",
			status: "cancelled",
		}),
	];

	it("drops cancelled projects by default", () => {
		const model = buildGanttModel(items, settings(), TODAY);
		expect(model.rows.map((r) => r.item.file.name)).toEqual(["live"]);
		expect(model.skipped.some((s) => s.reason === "cancelled")).toBe(true);
	});

	it("keeps cancelled projects when the switch is off", () => {
		const model = buildGanttModel(items, settings({ hideCancelledInGantt: false }), TODAY);
		expect(model.rows).toHaveLength(2);
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
				projectItem({ name: "dead", startDate: "2026-01-01", dueDate: "2026-01-02", status: "cancelled" }),
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
