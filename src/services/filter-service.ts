import {
	DefaultYearFilter,
	PROJECT_STATUSES,
	ProjectItem,
	ProjectStatus,
	SortMode,
} from "../types";
import { addDaysIso, daysInMonth, formatIso, todayIso } from "../utils/date";

/**
 * 筛选/排序管道（SPEC §4 F2）—— 纯函数，零 Obsidian 依赖。
 * 规则表逐条转写自 ref/projectOverview.js / ref/projectGantt.js：
 * - 日期区间：完整区间取交集、仅 start 取「≥」、仅 end 取「≤」；
 * - long-term: true 豁免日期筛选；
 * - 无日期项目在 overview 语义下保留（甘特适配层另行排除，±7 天兜底属渲染层）。
 */

/** 「已完成类」状态集合（继承 projectOverview.js completedStatuses 英文规范值） */
export const COMPLETED_LIKE_STATUSES: ProjectStatus[] = [
	"completed",
	"cancelled",
	"archived",
];

export type StatusPreset = "all" | "hide-completed" | "completed-only";
export type DateRangePreset = "all" | "week" | "month" | "quarter" | "year" | "custom";
export type AreaMode = "selected" | "include-current" | "exclude-current";
// SortMode 的定义收口在 types.ts（避免两处各写一份、加档位时漏改其一）
export type { SortMode };

export interface DateRangeState {
	preset: DateRangePreset;
	/** custom 模式的自定义区间（可只有一边） */
	start: string | null;
	end: string | null;
}

export interface FilterState {
	/** 多选状态 chips；空数组 = 不过滤 */
	statuses: ProjectStatus[];
	/** 多选领域（OR）；仅 selected 模式使用；空数组 = 不过滤 */
	areas: string[];
	areaMode: AreaMode;
	/** include/exclude-current 模式的参照领域（来自入口上下文） */
	currentAreas: string[];
	/** 已 lowercase 的搜索词（视图层负责归一） */
	search: string;
	dateRange: DateRangeState;
	/**
	 * 项目**开始年度**快捷筛选（null = 不限）。按 `startDate` 的年份严格匹配。
	 *
	 * 与 `dateRange` 的分工：dateRange 管「区间交集」，年度管「落在哪一年」。
	 * 年度是严格匹配——**无开始日期的项目不匹配任何年度**（要的就是把列表压下来），
	 * 这一点与 dateRange「无日期项目保留」的 overview 语义刻意不同，两者都有测试固化。
	 */
	startYear: number | null;
	/** 项目**结束年度**快捷筛选（null = 不限）。按 `dueDate` 的年份严格匹配。 */
	endYear: number | null;
}

export function defaultFilterState(): FilterState {
	return {
		statuses: [],
		areas: [],
		areaMode: "selected",
		currentAreas: [],
		search: "",
		dateRange: { preset: "all", start: null, end: null },
		startYear: null,
		endYear: null,
	};
}

/**
 * 视图初始筛选状态（打开 dashboard 时的默认值）。
 *
 * 三条业务默认：
 * - 隐藏已完成（SPEC F2.1，对齐现有脚本 `config.status = "hide"`）；
 * - **开始年度 = 当前年度**（用户要求 2026-09-18：默认只看今年启动的项目，否则项目太多）；
 * - 区间/领域/搜索均不限。
 *
 * 与 `defaultFilterState()` 的区别：后者是**中立基线**（什么都不筛），
 * 供纯函数测试与「清除筛选」使用——清除就该看到全部，而不是又回到默认筛选。
 *
 * @param today 注入「今天」（决定默认年度）；省略取本地日历今天
 * @param yearFilter 默认年度档（来自设置 defaultYearFilter）；`none` 表示默认不限年度
 */
export function initialFilterState(
	today?: string,
	yearFilter: DefaultYearFilter = "current",
): FilterState {
	return {
		...defaultFilterState(),
		statuses: presetToStatuses("hide-completed"),
		startYear: yearFilter === "none" ? null : currentYearOf(today ?? todayIso()),
	};
}

/** ISO 日期 → 年份；非法/缺失返回 null */
export function yearOf(iso: string | null): number | null {
	if (iso === null || !/^\d{4}/.test(iso)) return null;
	const year = Number(iso.slice(0, 4));
	return Number.isFinite(year) ? year : null;
}

function currentYearOf(todayIsoValue: string): number {
	return yearOf(todayIsoValue) ?? new Date().getFullYear();
}

/**
 * 数据里出现过的年度（开始年度 ∪ 结束年度），新的在前。
 * 下拉选项由数据驱动——列表里不会出现「一个项目都没有的年份」。
 */
export function collectYears(items: ProjectItem[]): number[] {
	const years = new Set<number>();
	for (const item of items) {
		const start = yearOf(item.startDate);
		if (start !== null) years.add(start);
		const end = yearOf(item.dueDate);
		if (end !== null) years.add(end);
	}
	return [...years].sort((a, b) => b - a);
}

/** 快捷档 → 多选集合（视图层把 chips 状态映射为这三档之一） */
export function presetToStatuses(preset: StatusPreset): ProjectStatus[] {
	switch (preset) {
		case "hide-completed":
			return PROJECT_STATUSES.filter((s) => !COMPLETED_LIKE_STATUSES.includes(s));
		case "completed-only":
			return [...COMPLETED_LIKE_STATUSES];
		case "all":
		default:
			return [...PROJECT_STATUSES];
	}
}

/**
 * 预设 → 具体区间（today 注入，纯函数可控可测）。
 * week 采用脚本现状（周日起始）；all = 不过滤（null/null）。
 */
export function resolveDateRange(
	preset: Exclude<DateRangePreset, "custom">,
	today: string,
): { start: string | null; end: string | null } {
	const [year, month, day] = today.split("-").map(Number);
	const base = new Date(Date.UTC(year, month - 1, day));
	switch (preset) {
		case "all":
			return { start: null, end: null };
		case "week": {
			const dow = base.getUTCDay(); // 0 = Sunday（脚本行为）
			const start = addDaysIso(today, -dow);
			return { start, end: addDaysIso(start, 6) };
		}
		case "month":
			return {
				start: formatIso(year, month, 1),
				end: formatIso(year, month, daysInMonth(year, month)),
			};
		case "quarter": {
			const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
			const quarterEndMonth = quarterStartMonth + 2;
			return {
				start: formatIso(year, quarterStartMonth, 1),
				end: formatIso(year, quarterEndMonth, daysInMonth(year, quarterEndMonth)),
			};
		}
		case "year":
			return { start: formatIso(year, 1, 1), end: formatIso(year, 12, 31) };
	}
}

export interface FilterOptions {
	/** 注入「今天」（相对预设区间解析用）；省略时取本地日历今天。注入便于测试与跨日刷新。 */
	today?: string;
}

/**
 * 筛选管道：status → area → search → date → year（AND 组合；F2.7 一套管道两处渲染）
 * @param options.today 相对日期预设（本周/本月/本季度/本年）与默认年度的基准日
 */
export function applyFilters(
	items: ProjectItem[],
	state: FilterState,
	options: FilterOptions = {},
): ProjectItem[] {
	let result = items;

	if (state.statuses.length > 0) {
		result = result.filter(
			(item) => item.status !== null && state.statuses.includes(item.status),
		);
	}

	result = filterByArea(result, state);
	result = filterBySearch(result, state.search);
	result = filterByDateRange(result, state.dateRange, options.today ?? todayIso());
	result = filterByYear(result, state);

	return result;
}

/**
 * 年度筛选（用户要求 2026-09-18）—— 把「项目太多」这件事压下来的主力。
 *
 * 严格匹配语义：选了「开始年度 = 2026」就只留 `startDate` 落在 2026 的项目；
 * **无开始日期的项目不匹配任何年度**（否则这层筛选对没填日期的项目完全失效）。
 *
 * long-term 豁免（用户口径 2026-09-20 修订）：原先这里刻意**不**豁免，理由是
 * 「年度筛选就是为了缩小范围，豁免等于把这类项目又放回来」。实际用下来那条理由是错的
 * ——长期项目本来就没有起止时间，于是它永远不匹配任何年度，而默认年度筛选恰好是
 * 「只看本年度启动」：结果是**标了长期反而什么都看不见**，这个标记等于没兑现。
 * 现在与区间筛选口径一致：两种筛选都豁免 longTerm。
 */
function filterByYear(items: ProjectItem[], state: FilterState): ProjectItem[] {
	if (state.startYear === null && state.endYear === null) return items;
	return items.filter((item) => {
		if (item.longTerm) return true;
		if (state.startYear !== null && yearOf(item.startDate) !== state.startYear) {
			return false;
		}
		if (state.endYear !== null && yearOf(item.dueDate) !== state.endYear) {
			return false;
		}
		return true;
	});
}

function filterByArea(items: ProjectItem[], state: FilterState): ProjectItem[] {
	switch (state.areaMode) {
		case "selected":
			if (state.areas.length === 0) return items;
			return items.filter((item) => item.area.some((a) => state.areas.includes(a)));
		case "include-current":
			if (state.currentAreas.length === 0) return items;
			return items.filter((item) => item.area.some((a) => state.currentAreas.includes(a)));
		case "exclude-current":
			if (state.currentAreas.length === 0) return items;
			return items.filter(
				(item) => !item.area.some((a) => state.currentAreas.includes(a)),
			);
	}
}

function filterBySearch(items: ProjectItem[], search: string): ProjectItem[] {
	const keyword = search.trim().toLowerCase();
	if (keyword.length === 0) return items;
	return items.filter((item) => item.file.name.toLowerCase().includes(keyword));
}

function filterByDateRange(
	items: ProjectItem[],
	range: DateRangeState,
	today: string,
): ProjectItem[] {
	const resolved =
		range.preset === "custom"
			? { start: range.start, end: range.end }
			: resolveDateRange(range.preset, today);
	if (resolved.start === null && resolved.end === null) {
		return items;
	}
	return items.filter((item) => matchDateFilter(item, resolved.start, resolved.end));
}

/**
 * 日期匹配规则表（转写自 projectOverview.js）：
 * - 完整区间：项目区间与筛选区间取交集（边界含）；
 * - 仅 start：项目的 start/end 落在边界之后；
 * - 仅 end：项目的 start/end 落在边界之前；
 * - 无日期项目保留（overview 卡片语义）。
 */
function matchDateFilter(
	item: ProjectItem,
	filterStart: string | null,
	filterEnd: string | null,
): boolean {
	if (item.longTerm) return true;

	const projectStart = item.startDate;
	const projectEnd = item.dueDate;

	if (filterStart !== null && filterEnd !== null) {
		if (projectStart !== null && projectEnd !== null) {
			return projectStart <= filterEnd && projectEnd >= filterStart;
		}
		if (projectStart !== null) {
			return projectStart >= filterStart && projectStart <= filterEnd;
		}
		if (projectEnd !== null) {
			return projectEnd >= filterStart && projectEnd <= filterEnd;
		}
		return true;
	}

	if (filterStart !== null) {
		if (projectStart !== null) return projectStart >= filterStart;
		if (projectEnd !== null) return projectEnd >= filterStart;
		return true;
	}

	// 此时 filterStart === null（filterEnd 为 null 的情况上游已排除，防御性收窄）
	if (filterEnd === null) return false;
	if (projectStart !== null) return projectStart <= filterEnd;
	if (projectEnd !== null) return projectEnd <= filterEnd;
	return true;
}

/**
 * 排序（F2.6）：不修改原数组。
 *
 * `manual` 档在这里是恒等变换——手动顺序是**分组维度**的记录（哪个分组在前、
 * 组内哪个项目在前），由 manual-order.ts 在分组之后重排，
 * 全局扁平的 sort 表达不了它，硬塞进来只会两处逻辑打架。
 */
export function sortProjects(items: ProjectItem[], mode: SortMode): ProjectItem[] {
	const copy = [...items];
	switch (mode) {
		case "due-asc":
			return copy.sort((a, b) => compareOptionalIso(a.dueDate, b.dueDate));
		case "name":
			// 码点比较而非 localeCompare("zh")：pinyin collation 依赖运行时 ICU 版本，
			// Electron 与 Node/测试环境可能不一致；码点序跨环境确定（拉丁在前、汉字在后）。
			return copy.sort((a, b) => (a.file.name < b.file.name ? -1 : a.file.name > b.file.name ? 1 : 0));
		case "priority":
			return copy.sort((a, b) => comparePriority(a.priority, b.priority));
		case "manual":
			return copy;
	}
}

function compareOptionalIso(a: string | null, b: string | null): number {
	if (a === null && b === null) return 0;
	if (a === null) return 1; // 无日期排最后
	if (b === null) return -1;
	return a.localeCompare(b);
}

const PRIORITY_ORDER = ["1", "2", "3", "4", "5"];

function comparePriority(a: string | null, b: string | null): number {
	const rankA = a !== null ? PRIORITY_ORDER.indexOf(a) : -1;
	const rankB = b !== null ? PRIORITY_ORDER.indexOf(b) : -1;
	if (rankA === rankB) return 0;
	if (rankA === -1) return 1; // 无效/缺失排最后
	if (rankB === -1) return -1;
	return rankA - rankB;
}

// ────────────────────────── 视图状态的纯逻辑 ──────────────────────────
// 这些原本住在 filter-bar.ts（视图层），但它们是纯函数且决定「筛选是否生效」，
// 放在服务层才可以不依赖 DOM 直接测——视图只负责把结果画成控件。

/** 多选开关：已选则取消，未选则追加（保序） */
export function toggle<T>(list: T[], value: T): T[] {
	return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** 当前 status 多选属于哪一档快捷预设（都不匹配则视为「全部」） */
export function detectStatusPreset(statuses: ProjectStatus[]): StatusPreset {
	const selected = [...statuses].sort();
	if (sameSet(selected, [...presetToStatuses("hide-completed")].sort())) {
		return "hide-completed";
	}
	if (sameSet(selected, [...presetToStatuses("completed-only")].sort())) {
		return "completed-only";
	}
	return "all";
}

function sameSet(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * 是否存在「非默认」筛选（决定要不要显示「清除筛选」）。
 *
 * 基准是**视图默认档**而不是空集合：默认是「隐藏已完成 + 开始年度=当年」，
 * 拿空集合比会让清除按钮一打开就常驻。
 */
export function hasActiveFilter(
	state: FilterState,
	today?: string,
	yearFilter: DefaultYearFilter = "current",
): boolean {
	const base = initialFilterState(today, yearFilter);
	const isDefaultStatuses = sameSet(
		[...state.statuses].sort(),
		[...base.statuses].sort(),
	);
	return (
		!isDefaultStatuses ||
		state.areas.length > 0 ||
		state.areaMode !== "selected" ||
		state.search.trim().length > 0 ||
		state.dateRange.preset !== "all" ||
		state.startYear !== base.startYear ||
		state.endYear !== base.endYear
	);
}
