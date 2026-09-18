import { describe, expect, it } from "vitest";
import {
	normalizeBoolean,
	normalizeDate,
	normalizeProgress,
	normalizeStatus,
	normalizeStringArray,
} from "../src/services/normalize";

/**
 * SPEC §2.3 数据规范化层 —— 行为基准来自 ref/projectOverview.js / ref/projectGantt.js。
 */
describe("normalizeStatus", () => {
	it("passes canonical english statuses through", () => {
		for (const s of [
			"inbox",
			"draft",
			"active",
			"on-hold",
			"completed",
			"cancelled",
			"archived",
		]) {
			expect(normalizeStatus(s, true)).toBe(s);
		}
	});

	it("maps chinese aliases to canonical statuses when compat enabled", () => {
		expect(normalizeStatus("执行中", true)).toBe("active");
		expect(normalizeStatus("完成", true)).toBe("completed");
		expect(normalizeStatus("未开始/待启动", true)).toBe("inbox");
		expect(normalizeStatus("起草/构思中", true)).toBe("draft");
		expect(normalizeStatus("暂停", true)).toBe("on-hold");
		expect(normalizeStatus("取消", true)).toBe("cancelled");
		expect(normalizeStatus("归档", true)).toBe("archived");
	});

	it("returns null for chinese aliases when compat disabled", () => {
		expect(normalizeStatus("执行中", false)).toBeNull();
	});

	it("returns null for unknown or missing values", () => {
		expect(normalizeStatus("unknown", true)).toBeNull();
		expect(normalizeStatus(undefined, true)).toBeNull();
		expect(normalizeStatus(null, true)).toBeNull();
		expect(normalizeStatus(123, true)).toBeNull();
	});
});

describe("normalizeDate", () => {
	it("parses YYYY-MM-DD and returns ISO", () => {
		expect(normalizeDate("2026-09-01")).toEqual({ kind: "ok", iso: "2026-09-01" });
	});

	it("parses separator variants (slash / dot) to ISO", () => {
		expect(normalizeDate("2026/09/01")).toEqual({ kind: "ok", iso: "2026-09-01" });
		expect(normalizeDate("2026.09.01")).toEqual({ kind: "ok", iso: "2026-09-01" });
	});

	it("parses compact YYYYMMDD strings and numbers", () => {
		expect(normalizeDate("20260901")).toEqual({ kind: "ok", iso: "2026-09-01" });
		expect(normalizeDate(20260901)).toEqual({ kind: "ok", iso: "2026-09-01" });
	});

	it("rejects impossible calendar dates as invalid", () => {
		expect(normalizeDate("2026-13-01")).toEqual({ kind: "invalid", raw: "2026-13-01" });
		expect(normalizeDate("2026-02-30")).toEqual({ kind: "invalid", raw: "2026-02-30" });
		expect(normalizeDate("2026-00-10")).toEqual({ kind: "invalid", raw: "2026-00-10" });
	});

	it("marks garbage values as invalid, not null", () => {
		expect(normalizeDate("not-a-date")).toEqual({ kind: "invalid", raw: "not-a-date" });
		expect(normalizeDate("")).toEqual({ kind: "invalid", raw: "" });
	});

	it("returns null for missing values (absent ≠ invalid)", () => {
		expect(normalizeDate(undefined)).toBeNull();
		expect(normalizeDate(null)).toBeNull();
	});

	it("round-trips a real calendar day (leap year)", () => {
		expect(normalizeDate("2028-02-29")).toEqual({ kind: "ok", iso: "2028-02-29" });
		expect(normalizeDate("2027-02-29")).toEqual({ kind: "invalid", raw: "2027-02-29" });
	});
});

describe("normalizeStringArray", () => {
	it("wraps a single string", () => {
		expect(normalizeStringArray("CIMS工作")).toEqual(["CIMS工作"]);
	});

	it("keeps arrays and drops non-string members", () => {
		expect(normalizeStringArray(["a", "b"])).toEqual(["a", "b"]);
		expect(normalizeStringArray(["a", 1, null, "b"] as unknown[])).toEqual(["a", "b"]);
	});

	it("returns empty array for missing values", () => {
		expect(normalizeStringArray(undefined)).toEqual([]);
		expect(normalizeStringArray(null)).toEqual([]);
	});

	it("trims whitespace of members", () => {
		expect(normalizeStringArray([" a ", "b"])).toEqual(["a", "b"]);
	});
});

describe("normalizeProgress", () => {
	it("accepts numbers and numeric strings", () => {
		expect(normalizeProgress(40)).toBe(40);
		expect(normalizeProgress("40")).toBe(40);
		expect(normalizeProgress("40%")).toBe(40);
	});

	it("clamps to 0..100", () => {
		expect(normalizeProgress(150)).toBe(100);
		expect(normalizeProgress(-5)).toBe(0);
		expect(normalizeProgress("120")).toBe(100);
	});

	it("returns null for non-numeric input", () => {
		expect(normalizeProgress("abc")).toBeNull();
		expect(normalizeProgress(undefined)).toBeNull();
	});
});

describe("normalizeBoolean", () => {
	it("accepts real booleans", () => {
		expect(normalizeBoolean(true)).toBe(true);
		expect(normalizeBoolean(false)).toBe(false);
	});

	it("parses common truthy/falsy string spellings", () => {
		expect(normalizeBoolean("true")).toBe(true);
		expect(normalizeBoolean("false")).toBe(false);
		expect(normalizeBoolean("True")).toBe(true);
		expect(normalizeBoolean("1")).toBe(true);
		expect(normalizeBoolean("0")).toBe(false);
		expect(normalizeBoolean(1)).toBe(true);
		expect(normalizeBoolean(0)).toBe(false);
	});

	it("defaults to false for missing values", () => {
		expect(normalizeBoolean(undefined)).toBe(false);
		expect(normalizeBoolean(null)).toBe(false);
	});
});
