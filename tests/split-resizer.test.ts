import { describe, expect, it } from "vitest";
import { clampSplitWidth } from "../src/panels/split-resizer";
import { SIDEBAR_WIDTH_RANGE } from "../src/types";

/*
 * 分栏宽度收敛（用户口径 2026-09-21）。
 *
 * 抽成纯函数是为了让**拖动**与**设置迁移**共用同一条规则——两处各写一套上下限，
 * 迟早出现「拖出来 700，重启变 240」这种对不上的事。
 *
 * 非数字给下限而不是 NaN：NaN 写进 CSS 变量会让整条声明失效（`.pm-side` 悄悄回到
 * flex 默认值），界面上完全看不出为什么。
 */
describe("clampSplitWidth（分栏宽度收敛）", () => {
	const { min, max } = SIDEBAR_WIDTH_RANGE;

	it("keeps values inside the range, inclusive at both ends", () => {
		expect(clampSplitWidth(320, min, max)).toBe(320);
		expect(clampSplitWidth(min, min, max)).toBe(min);
		expect(clampSplitWidth(max, min, max)).toBe(max);
	});

	it("clamps out-of-range values instead of rejecting them", () => {
		// 越界收敛而不是丢弃：用户拖到上限是合理意图，丢回默认反而莫名其妙
		expect(clampSplitWidth(10, min, max)).toBe(min);
		expect(clampSplitWidth(5000, min, max)).toBe(max);
	});

	it("rounds to whole pixels and survives junk", () => {
		expect(clampSplitWidth(333.6, min, max)).toBe(334);
		expect(clampSplitWidth(Number.NaN, min, max)).toBe(min);
		expect(clampSplitWidth(Number.POSITIVE_INFINITY, min, max)).toBe(min);
	});

	it("falls back to the floor when the ceiling is below it", () => {
		// 上限小于下限（容器很窄时的动态上限）不返回自相矛盾的值
		expect(clampSplitWidth(500, 300, 200)).toBe(300);
	});
});
