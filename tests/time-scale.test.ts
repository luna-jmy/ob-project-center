import { describe, expect, it } from "vitest";
import { DAY_WIDTH, buildTimeScale } from "../src/gantt/time-scale";
import { diffDaysIso } from "../src/utils/date";

describe("时间轴刻度 — 范围与像素映射（SPEC F1.2）", () => {
	it("pads the range by one full unit on each side (month zoom)", () => {
		const scale = buildTimeScale("2026-01-05", "2026-12-31", "month");
		expect(scale.startIso).toBe("2025-12-01");
		expect(scale.endIso).toBe("2027-01-31");
	});

	it("pads by one day on each side at day zoom", () => {
		const scale = buildTimeScale("2026-01-05", "2026-01-10", "day");
		expect(scale.startIso).toBe("2026-01-04");
		expect(scale.endIso).toBe("2026-01-11");
	});

	it("pads by one week on each side at week zoom, weeks starting on Sunday", () => {
		// 2026-01-05 是周一 → 所在周从 2026-01-04（周日）开始
		const scale = buildTimeScale("2026-01-05", "2026-01-10", "week");
		expect(scale.startIso).toBe("2025-12-28");
		expect(scale.endIso).toBe("2026-01-17");
	});

	it("derives total width from the padded day count", () => {
		const scale = buildTimeScale("2026-01-05", "2026-01-10", "day");
		const days = diffDaysIso(scale.startIso, scale.endIso) + 1;
		expect(scale.totalWidth).toBe(days * DAY_WIDTH.day);
	});

	it("normalizes a reversed range instead of producing negative widths", () => {
		const scale = buildTimeScale("2026-06-01", "2026-01-01", "month");
		expect(scale.totalWidth).toBeGreaterThan(0);
		expect(scale.startIso < scale.endIso).toBe(true);
	});

	it("maps dates to pixels and back (drag writes back through the inverse map)", () => {
		const scale = buildTimeScale("2026-01-01", "2026-03-31", "day");
		const x = scale.xForDate("2026-02-10");
		expect(scale.dateForX(x)).toBe("2026-02-10");
		expect(scale.dateForX(x + DAY_WIDTH.day / 2)).toBe("2026-02-10");
	});

	it("treats bar ends as closed intervals (end edge sits one day past the end date)", () => {
		const scale = buildTimeScale("2026-01-01", "2026-03-31", "day");
		expect(scale.endXForDate("2026-02-10")).toBe(
			scale.xForDate("2026-02-10") + DAY_WIDTH.day,
		);
		// 单日任务至少有一个日宽的可见条
		expect(scale.endXForDate("2026-02-10") - scale.xForDate("2026-02-10")).toBe(
			DAY_WIDTH.day,
		);
	});
});

describe("时间轴刻度 — 表头两级刻度", () => {
	it("uses months as lower columns at month zoom, years as upper", () => {
		const scale = buildTimeScale("2026-01-05", "2026-03-10", "month");
		const lower = scale.lower.map((c) => c.label);
		expect(lower).toEqual(["2025-12", "2026-01", "2026-02", "2026-03", "2026-04"]);
		expect(scale.upper.map((c) => c.label)).toEqual(["2025", "2026"]);
	});

	it("uses single days as lower columns at day zoom", () => {
		const scale = buildTimeScale("2026-01-05", "2026-01-07", "day");
		expect(scale.lower.map((c) => c.label)).toEqual(["4", "5", "6", "7", "8"]);
		expect(scale.upper.map((c) => c.label)).toEqual(["2026-01"]);
	});

	it("uses weeks as lower columns and labels them with the week start date", () => {
		const scale = buildTimeScale("2026-01-05", "2026-01-10", "week");
		expect(scale.lower.map((c) => c.label)).toEqual(["12/28", "1/4", "1/11"]);
	});

	it("columns are contiguous in x (no gaps, no overlaps)", () => {
		const scale = buildTimeScale("2026-01-01", "2026-06-30", "week");
		for (let i = 1; i < scale.lower.length; i++) {
			const prev = scale.lower[i - 1];
			const curr = scale.lower[i];
			if (prev === undefined || curr === undefined) throw new Error("missing column");
			expect(curr.x).toBeCloseTo(prev.x + prev.width, 6);
		}
	});

	it("spans the full scale width across columns", () => {
		const scale = buildTimeScale("2026-01-01", "2026-06-30", "month");
		const first = scale.lower[0];
		const last = scale.lower[scale.lower.length - 1];
		if (first === undefined || last === undefined) throw new Error("missing column");
		expect(first.x).toBe(0);
		expect(last.x + last.width).toBeCloseTo(scale.totalWidth, 6);
	});

	/*
	 * 回归测试：粗粒度行（month 档的「年」、year 档的「年」）的首列往往从区间之前就开始了。
	 * 表头是按列宽顺序流式排布的，一旦首列伸出画布，整行标签就会与下面的网格线错开
	 * ——「2025」会横跨整个可视区，而它其实只该占 12 月那一条。
	 */
	it("clamps the coarse row to the scale range so labels stay aligned with the grid", () => {
		const scale = buildTimeScale("2026-01-05", "2026-03-10", "month");
		const first = scale.upper[0];
		if (first === undefined) throw new Error("missing column");
		expect(first.x).toBe(0);
		for (let i = 1; i < scale.upper.length; i++) {
			const prev = scale.upper[i - 1];
			const curr = scale.upper[i];
			if (prev === undefined || curr === undefined) throw new Error("missing column");
			expect(curr.x).toBeCloseTo(prev.x + prev.width, 6);
		}
	});
});

/*
 * 年档（用户要求 2026-09-20）：原先最粗只到 month，一年要 1800+ px 横向拖才看得完，
 * 「看全年」这个需求根本没被满足；这里锁住「一整年明显窄于一屏」这条底线。
 */
describe("时间轴刻度 — 年档（按季度画线，一屏看全年）", () => {
	it("exposes a day width for every zoom mode", () => {
		expect(Object.keys(DAY_WIDTH).sort()).toEqual(["day", "month", "week", "year"]);
	});

	it("uses quarters as lower columns and years as upper", () => {
		const scale = buildTimeScale("2026-01-05", "2026-08-10", "year");
		expect(scale.lower.map((c) => c.label)).toEqual([
			"2025-Q4",
			"2026-Q1",
			"2026-Q2",
			"2026-Q3",
			"2026-Q4",
		]);
		expect(scale.upper.map((c) => c.label)).toEqual(["2025", "2026"]);
	});

	it("pads by one full quarter on each side", () => {
		const scale = buildTimeScale("2026-02-01", "2026-03-31", "year");
		expect(scale.startIso).toBe("2025-10-01");
		expect(scale.endIso).toBe("2026-06-30");
	});

	it("aligns quarters to calendar quarter boundaries", () => {
		const scale = buildTimeScale("2026-05-20", "2026-05-20", "year");
		const q2 = scale.lower.find((c) => c.label === "2026-Q2");
		expect(q2?.startIso).toBe("2026-04-01");
		expect(q2?.endIso).toBe("2026-06-30");
	});

	it("fits a whole calendar year into one screen width", () => {
		const scale = buildTimeScale("2026-01-01", "2026-12-31", "year");
		const monthZoom = buildTimeScale("2026-01-01", "2026-12-31", "month");
		expect(scale.totalWidth).toBeLessThan(700);
		// 与月档拉开明显差距，否则这一档就没有存在意义
		expect(scale.totalWidth).toBeLessThan(monthZoom.totalWidth / 2);
	});
});

describe("时间轴刻度 — 今天标记", () => {
	it("places the today marker inside the range", () => {
		const scale = buildTimeScale("2026-01-01", "2026-12-31", "month", {
			today: "2026-06-15",
		});
		expect(scale.todayX).not.toBeNull();
		const x = scale.xForDate("2026-06-15");
		expect(scale.todayX).toBeCloseTo(x + DAY_WIDTH.month / 2, 6);
	});

	it("omits the marker when today is outside the range", () => {
		const scale = buildTimeScale("2026-01-01", "2026-03-01", "month", {
			today: "2030-06-15",
		});
		expect(scale.todayX).toBeNull();
	});

	it("omits the marker when today is not supplied", () => {
		expect(buildTimeScale("2026-01-01", "2026-03-01", "month").todayX).toBeNull();
	});
});
