import { describe, expect, it } from "vitest";
import { BAR_COLOR_PRESETS, isHexColor } from "../src/gantt/bar-colors";
import { isColorLike } from "../src/services/normalize";

/*
 * 甘特条预设颜色（用户要求 2026-09-20：「预设几个颜色，不要全部 RGB 选择」）。
 *
 * 预设值是**数据**：写错一个字母的后果是「点了色块但条子没变色」，
 * 而且会平白多出一条「数据问题」（索引层会判它非法）——所以在这里逐条校验。
 */
describe("甘特条预设颜色", () => {
	it("every preset passes the same validator the index uses", () => {
		for (const preset of BAR_COLOR_PRESETS) {
			if (preset.value === null) continue;
			expect(isColorLike(preset.value), `${preset.label} → ${preset.value}`).toBe(true);
		}
	});

	it("uses theme variables so light and dark themes both look right", () => {
		for (const preset of BAR_COLOR_PRESETS) {
			if (preset.value === null) continue;
			expect(preset.value.startsWith("var(--")).toBe(true);
		}
	});

	it("has exactly one 「默认」 slot and it carries no value", () => {
		const defaults = BAR_COLOR_PRESETS.filter((preset) => preset.value === null);
		expect(defaults).toHaveLength(1);
		expect(defaults[0]?.label).toContain("默认");
	});

	it("offers enough colors to be useful, without duplicates in value or label", () => {
		expect(BAR_COLOR_PRESETS.length).toBeGreaterThanOrEqual(6);
		const values = BAR_COLOR_PRESETS.map((preset) => preset.value);
		expect(new Set(values).size).toBe(values.length);
		const labels = BAR_COLOR_PRESETS.map((preset) => preset.label);
		expect(new Set(labels).size).toBe(labels.length);
	});
});

describe("取色器的 hex 判定", () => {
	it("accepts only six-digit hex (what <input type=\"color\"> understands)", () => {
		expect(isHexColor("#ff8800")).toBe(true);
		expect(isHexColor("#FF8800")).toBe(true);
		// 缩写、主题变量、具名色都不能喂给原生取色器
		expect(isHexColor("#f80")).toBe(false);
		expect(isHexColor("var(--color-red)")).toBe(false);
		expect(isHexColor("red")).toBe(false);
	});
});
