import { describe, expect, it } from "vitest";
import { isColorLike } from "../src/services/normalize";
import { buildProjectItem } from "../src/services/project-item";
import { DEFAULT_SETTINGS } from "../src/types";

/**
 * 甘特条自定义颜色（用户要求 2026-09-20）。
 *
 * 颜色值最终写进 CSS 变量给 SVG 用。非法值不会执行代码，但会让任务条
 * **静默退回默认色**——这类「看着没坏、其实没生效」的失效最难排查，
 * 所以这里把校验口径固化下来：能识别的才算数，识别不了的显式报 issue。
 */

describe("颜色值校验", () => {
	it("accepts hex in all standard lengths", () => {
		expect(isColorLike("#f80")).toBe(true);
		expect(isColorLike("#ff8800")).toBe(true);
		expect(isColorLike("#ff8800cc")).toBe(true);
	});

	it("accepts rgb/hsl functional notations", () => {
		expect(isColorLike("rgb(255, 136, 0)")).toBe(true);
		expect(isColorLike("rgba(255,136,0,0.5)")).toBe(true);
		expect(isColorLike("hsl(30, 100%, 50%)")).toBe(true);
	});

	it("accepts theme variables so the bar can follow the theme", () => {
		expect(isColorLike("var(--color-red)")).toBe(true);
		expect(isColorLike("var(--interactive-accent)")).toBe(true);
	});

	it("accepts named colors", () => {
		expect(isColorLike("tomato")).toBe(true);
		expect(isColorLike("transparent")).toBe(true);
	});

	it("rejects things that would silently render nothing useful", () => {
		expect(isColorLike("")).toBe(false);
		expect(isColorLike("   ")).toBe(false);
		expect(isColorLike("#12345")).toBe(false);
		expect(isColorLike("url(evil.png)")).toBe(false);
		expect(isColorLike("red; background: blue")).toBe(false);
		expect(isColorLike("var(--x) !important")).toBe(false);
	});

	it("rejects non-strings", () => {
		expect(isColorLike(null)).toBe(false);
		expect(isColorLike(123)).toBe(false);
		expect(isColorLike({})).toBe(false);
	});
});

describe("索引读取颜色字段", () => {
	function build(raw: unknown, colorField = "color") {
		return buildProjectItem(
			{ type: "project", [colorField]: raw },
			{ path: "100 Projects/a.md", name: "a", folder: "100 Projects" },
			{ ...DEFAULT_SETTINGS, fieldMapping: { ...DEFAULT_SETTINGS.fieldMapping, color: colorField } },
		);
	}

	it("reads a valid color", () => {
		const { item, issues } = build("#ff8800");
		expect(item?.color).toBe("#ff8800");
		expect(issues).toHaveLength(0);
	});

	it("keeps null for a missing color (no issue — it just means「用默认色」)", () => {
		const { item, issues } = build(undefined);
		expect(item?.color).toBeNull();
		expect(issues).toHaveLength(0);
	});

	it("reports an issue instead of silently dropping an unrecognized value", () => {
		const { item, issues } = build("亮橙色");
		expect(item?.color).toBeNull();
		expect(issues.some((i) => i.reason === "invalid-color" && i.raw === "亮橙色")).toBe(true);
	});

	it("honours a remapped physical field name", () => {
		const { item } = build("tomato", "bar-color");
		expect(item?.color).toBe("tomato");
	});
});
