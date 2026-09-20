/**
 * 甘特条预设颜色（用户要求 2026-09-20：「预设几个颜色，不要全部 RGB 选择」）。
 *
 * 两个入口共用这一份清单：项目编辑弹窗的预设色块、任务条右键菜单的颜色项。
 *
 * ── 为什么用主题色变量而不是写死 hex ──────────────────────────────────
 * - 明暗主题自动适配：写死的 hex 在白底上刺眼、在暗底上又太闷，用户还得手动调；
 * - `var(--color-x)` 本身就是合法的 CSS 颜色，normalize 层的 `isColorLike` 认识这种写法，
 *   存进 frontmatter 后自绘甘特图与侧栏色点都能直接用；
 * - 想自定义的人也没被堵死：弹窗里的文本框仍然吃 #hex / 颜色名 / var()。
 *
 * 单独一个模块（不 import obsidian）是为了能被单测直接覆盖：
 * 预设值一旦写错，用户看到的是「点了色块但条子没变色」，很难排查。
 */

import { PRIORITY_LABELS, ProjectStatus } from "../types";

export interface BarColorPreset {
	/** 写进 frontmatter 的值；`null` = 不指定，按项目状态用默认色 */
	value: string | null;
	label: string;
}

export const BAR_COLOR_PRESETS: readonly BarColorPreset[] = [
	{ value: null, label: "默认（按状态）" },
	{ value: "var(--color-red)", label: "红" },
	{ value: "var(--color-orange)", label: "橙" },
	{ value: "var(--color-yellow)", label: "黄" },
	{ value: "var(--color-green)", label: "绿" },
	{ value: "var(--color-cyan)", label: "青" },
	{ value: "var(--color-blue)", label: "蓝" },
	{ value: "var(--color-purple)", label: "紫" },
	{ value: "var(--color-pink)", label: "粉" },
];

/** 取色器（`<input type="color">`）只认 `#rrggbb`，其余写法都只能走文本框 */
export function isHexColor(value: string): boolean {
	return /^#[0-9a-f]{6}$/i.test(value);
}

// ────────────────────── 配色类别（用户口径 2026-09-20） ──────────────────────

/** 关键任务对应的优先级规范值：1 = 最高、2 = 高 */
const CRITICAL_PRIORITIES = ["1", "2"] as const;

/**
 * 认哪些写法算关键任务。
 *
 * 除规范值外还认模板 suggester 的中文标签（「最高」「高」）：priority 是自由文本字段，
 * 手写 frontmatter 时很容易写成中文标签，不认的话表现同样是
 * 「设了高优先级、条子却毫无变化」。标签从 PRIORITY_LABELS 反查，
 * 以后改标签文案这里自动跟着走。
 */
const CRITICAL_VALUES = new Set<string>([
	...CRITICAL_PRIORITIES,
	...CRITICAL_PRIORITIES.map((value) => PRIORITY_LABELS[value] ?? value),
]);

/**
 * 这条项目算不算关键任务（Mermaid 的 `crit`）。
 *
 * 自绘甘特图描红边、Mermaid 导出写 `crit`，**两处共用这一份判断**：
 * 各写一份的话迟早漂移成「图上标红了、导出却没有 crit」。
 */
export function isCriticalPriority(priority: string | null): boolean {
	return priority !== null && CRITICAL_VALUES.has(priority.trim());
}

/** 填充色取哪一个键（关键任务是在填充之上再叠描边，所以不在这里） */
export type BarFillKey = "active" | "completed" | "fallback";

/**
 * 按状态决定填充色键。
 *
 * 只有 `active` / `completed` 两档特殊，其余状态（未开始 / 起草 / 暂停 / 取消 / 归档 /
 * 状态非法）一律走 `fallback`——这正是用户要的收敛：颜色多到没有信息量，
 * 反而看不出重点；而且 Mermaid 那边本来也只有这三种标记会改变任务的外观。
 */
export function barFillKey(status: ProjectStatus | null): BarFillKey {
	if (status === "active") return "active";
	if (status === "completed") return "completed";
	return "fallback";
}

/**
 * 这条要不要画进度覆盖层（`progress` 字段）。
 *
 * 只有「执行中」画（用户口径 2026-09-20）：已完成的进度本该就是 100%，
 * 那些「已完成但 progress 还停在 50」是没更新字段的数据问题，画出来只会让人
 * 以为条子配色错乱（实际是进度层叠在条色上）。暂停同理——不推进的项目不显示推进度。
 */
export function showsProgress(status: ProjectStatus | null): boolean {
	return status === "active";
}
