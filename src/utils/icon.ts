/**
 * 视图 / 侧栏图标的选名逻辑（用户口径 2026-09-20：换个不像「白板」的图标）。
 *
 * 缘起：原先用的是 `layout-dashboard`，那正是 Obsidian 内置「白板（Canvas）」的图标，
 * 侧栏上两个图标长得一模一样，分不清谁是谁。
 *
 * 为什么要「查一遍再用」：Lucide 改过名（`chart-gantt` → `gantt-chart` 等），
 * 而 Obsidian 内置的是某个固定快照。首选名一旦不在内置集里，`setIcon` 不会报错、
 * 只会画出一个**空白图标**——比撞脸更难发现，所以要能退档。
 *
 * 本模块刻意不 import obsidian，方便被单测直接覆盖（同 bar-colors.ts 的口径）。
 */

/**
 * 候选图标：**第一个就是选定要用的那一个**（用户选定 `gantt-chart`，2026-09-20）。
 *
 * 后面几个不是「备选风格」，而是**退档链**：万一当前 Obsidian 内置的 Lucide 快照里
 * 没有 `gantt-chart`（Lucide 改过名），就按顺序退到下一个真实存在的，
 * 免得 `setIcon` 不报错、只静默画出一个空白图标。
 */
export const ICON_CANDIDATES: readonly string[] = [
	"gantt-chart",
	"calendar-range",
	"kanban",
	"list-checks",
	"layout-list",
];

/**
 * 从候选里挑出第一个「当前环境真的注册过」的图标名。
 *
 * Obsidian 的 `getIconIds()` 返回的是 `lucide-xxx` 形式的 id（自定义图标不带前缀），
 * 所以比对前先去掉前缀。全部都不认时退回第一个候选——宁可图标画不出来，
 * 也不要静默换成一个语义无关的形状。
 */
export function pickViewIcon(
	iconIds: readonly string[],
	candidates: readonly string[] = ICON_CANDIDATES,
): string {
	const available = new Set(iconIds.map((id) => id.replace(/^lucide-/, "")));
	return candidates.find((name) => available.has(name)) ?? candidates[0] ?? "gantt-chart";
}
