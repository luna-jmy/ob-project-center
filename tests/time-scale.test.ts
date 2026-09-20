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
