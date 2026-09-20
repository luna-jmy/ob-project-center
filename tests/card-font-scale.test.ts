import { describe, expect, it } from "vitest";
import { migrateSettings } from "../src/settings-migration";
import { CARD_FONT_SCALE_RANGE, DEFAULT_SETTINGS } from "../src/types";

/*
 * 面板卡片字号缩放（用户口径 2026-09-20）。
 *
 * 设置里存百分比、样式表按倍率用 `calc(倍率 * 主题字号)`，所以最怕的是
 * 「存进去一个不可能的数值」——那会让卡片文字凭空变成另一档，而且看不出原因。
 * 这组用例把清洗口径钉住：范围内照收、范围外与非数字一律退回默认（不静默夹取）。
 */
describe("面板文字大小 — 设置清洗", () => {
	it("backfills 100 (跟随主题) for data.json written before this setting existed", () => {
		expect(migrateSettings({}).cardFontScale).toBe(100);
		expect(DEFAULT_SETTINGS.cardFontScale).toBe(100);
	});

	it("keeps values inside the allowed range", () => {
		expect(migrateSettings({ cardFontScale: 120 }).cardFontScale).toBe(120);
		expect(migrateSettings({ cardFontScale: CARD_FONT_SCALE_RANGE.min }).cardFontScale).toBe(
			CARD_FONT_SCALE_RANGE.min,
		);
		expect(migrateSettings({ cardFontScale: CARD_FONT_SCALE_RANGE.max }).cardFontScale).toBe(
			CARD_FONT_SCALE_RANGE.max,
		);
	});

	it("falls back for out-of-range values instead of clamping them silently", () => {
		// 把 900 悄悄夹成 220 只会让人以为自己没改对
		expect(migrateSettings({ cardFontScale: 900 }).cardFontScale).toBe(100);
		expect(migrateSettings({ cardFontScale: 10 }).cardFontScale).toBe(100);
	});

	it("falls back for non-numbers", () => {
		expect(migrateSettings({ cardFontScale: "big" }).cardFontScale).toBe(100);
		expect(migrateSettings({ cardFontScale: null }).cardFontScale).toBe(100);
		expect(migrateSettings({ cardFontScale: Number.NaN }).cardFontScale).toBe(100);
	});

	it("rounds fractions to whole percent", () => {
		expect(migrateSettings({ cardFontScale: 112.4 }).cardFontScale).toBe(112);
	});

	it("is idempotent", () => {
		const once = migrateSettings({ cardFontScale: 130 });
		expect(migrateSettings(once)).toEqual(once);
	});
});
