import { describe, expect, it } from "vitest";
import { barFillKey, isCriticalPriority, showsProgress } from "../src/gantt/bar-colors";
import { isColorLike } from "../src/services/normalize";
import { migrateSettings } from "../src/settings-migration";
import { barColorCopy, DEFAULT_GANTT_BAR_COLORS, DEFAULT_SETTINGS } from "../src/types";

/** 四类配色的键（显式列出来：Object.values 在这套 lib 里是 any，过不了 lint 的类型感知规则） */
const TONES = ["active", "completed", "critical", "fallback"] as const;

/*
 * 甘特条配色（用户口径 2026-09-20）：
 * 「有 Mermaid 颜色变化的状态才需要预设颜色」——即 active / done / crit 三类 + 其他兜底，
 * 其余交给默认色，需要时用户自己改。这组用例锁住类别判定、默认值与迁移清洗。
 */
describe("甘特条配色 — 类别判定", () => {
	it("treats priority 1 and 2 as critical (same rule as Mermaid's crit)", () => {
		expect(isCriticalPriority("1")).toBe(true);
		expect(isCriticalPriority("2")).toBe(true);
		expect(isCriticalPriority(" 2 ")).toBe(true);
		expect(isCriticalPriority("3")).toBe(false);
		expect(isCriticalPriority("")).toBe(false);
		expect(isCriticalPriority(null)).toBe(false);
	});

	/*
	 * priority 是自由文本字段，手写 frontmatter 时很容易写成模板的中文标签。
	 * 只认数字的话，表现是「明明设了「高」、条子却毫无变化」——所以中文标签也得认。
	 */
	it("accepts the template's Chinese priority labels", () => {
		expect(isCriticalPriority("最高")).toBe(true);
		expect(isCriticalPriority("高")).toBe(true);
		expect(isCriticalPriority(" 最高 ")).toBe(true);
		expect(isCriticalPriority("中")).toBe(false);
		expect(isCriticalPriority("低")).toBe(false);
	});

	it("fills by status only: active / completed get their own, everything else falls back", () => {
		expect(barFillKey("active")).toBe("active");
		expect(barFillKey("completed")).toBe("completed");
		for (const status of ["inbox", "draft", "on-hold", "cancelled", "archived", null] as const) {
			expect(barFillKey(status), String(status)).toBe("fallback");
		}
	});

	/*
	 * 关键任务在图上走的是**外描边**而不是填充，所以它绝不能同时是一个填充键——
	 * 否则「重要」会把「已完成」盖掉，两个信号互相吞掉一个。
	 */
	it("never returns critical as a fill key", () => {
		expect(barFillKey("active")).not.toBe("critical");
		expect(barFillKey("completed")).not.toBe("critical");
		expect(barFillKey(null)).not.toBe("critical");
	});

	/*
	 * 进度覆盖层只画给「执行中」（用户口径 2026-09-20）：
	 * 已完成 / 暂停的项目不该显示推进度——已完成的进度本该就是 100%，
	 * 那些停在 50 的是没更新字段的数据问题，画出来只会让人以为配色错乱。
	 */
	it("only draws the progress overlay for in-flight projects", () => {
		expect(showsProgress("active")).toBe(true);
		for (const status of [
			"completed",
			"on-hold",
			"inbox",
			"draft",
			"cancelled",
			"archived",
			null,
		] as const) {
			expect(showsProgress(status), String(status)).toBe(false);
		}
	});
});

describe("甘特条配色 — 默认值与设置页文案", () => {
	it("ships exactly the four tone keys and nothing else", () => {
		expect(Object.keys(DEFAULT_GANTT_BAR_COLORS).sort()).toEqual([
			"active",
			"completed",
			"critical",
			"fallback",
		]);
	});

	it("defaults pass the same color validator the index uses", () => {
		for (const tone of TONES) {
			const value = DEFAULT_GANTT_BAR_COLORS[tone];
			expect(isColorLike(value), `${tone} → ${value}`).toBe(true);
		}
	});

	it("uses theme variables so light and dark themes both look right", () => {
		for (const tone of TONES) {
			expect(DEFAULT_GANTT_BAR_COLORS[tone].startsWith("var(--"), tone).toBe(true);
		}
	});

	it("carries a label and description for every tone", () => {
		// 覆盖性由类型保证；这里守住每个色调都真能取到非空文案
		for (const tone of Object.keys(DEFAULT_GANTT_BAR_COLORS) as (keyof typeof DEFAULT_GANTT_BAR_COLORS)[]) {
			const copy = barColorCopy(tone);
			expect(copy.label.length, tone).toBeGreaterThan(0);
			expect(copy.desc.length, tone).toBeGreaterThan(0);
		}
	});
});

describe("甘特条配色 — 迁移清洗", () => {
	it("backfills defaults for data.json written before this setting existed", () => {
		expect(migrateSettings({}).ganttBarColors).toEqual(DEFAULT_GANTT_BAR_COLORS);
	});

	it("keeps valid custom colors and repairs only the broken ones", () => {
		const migrated = migrateSettings({
			ganttBarColors: { active: "#3b82f6", completed: "   ", critical: "var(--color-red)" },
		});
		expect(migrated.ganttBarColors).toEqual({
			active: "#3b82f6",
			completed: DEFAULT_GANTT_BAR_COLORS.completed,
			critical: "var(--color-red)",
			fallback: DEFAULT_GANTT_BAR_COLORS.fallback,
		});
	});

	it("falls back entirely when the stored value is not an object", () => {
		expect(migrateSettings({ ganttBarColors: "blue" }).ganttBarColors).toEqual(
			DEFAULT_GANTT_BAR_COLORS,
		);
	});

	it("is idempotent", () => {
		const once = migrateSettings({ ganttBarColors: { critical: "#ff0000" } });
		expect(migrateSettings(once)).toEqual(once);
	});

	it("does not share the default object with the settings instance", () => {
		// 共享可变对象是隐患：改一处会污染 DEFAULT_SETTINGS（同 DEFAULT_SETTINGS 的既有口径）
		expect(DEFAULT_SETTINGS.ganttBarColors).not.toBe(DEFAULT_GANTT_BAR_COLORS);
	});
});
