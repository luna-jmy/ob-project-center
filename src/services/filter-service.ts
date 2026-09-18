import { PROJECT_STATUSES, ProjectItem, ProjectStatus } from "../types";

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
export type SortMode = "due-asc" | "name" | "priority";

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
}

export function defaultFilterState(): FilterState {
	return {
		statuses: [],
		areas: [],
		areaMode: "selected",
		currentAreas: [],
		search: "",
		dateRange: { preset: "all", start: null, end: null },
	};
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
	todayIso: string,
): { start: string | null; end: string | null } {
	const [year, month, day] = todayIso.split("-").map(Number);
	const base = new Date(Date.UTC(year, month - 1, day));
	switch (preset) {
		case "all":
			return { start: null, end: null };
		case "week": {
			const dow = base.getUTCDay(); // 0 = Sunday（脚本行为）
			const start = addDaysIso(todayIso, -dow);
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

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDaysIso(iso: string, days: number): string {
	const [year, month, day] = iso.split("-").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day + days));
	return date.toISOString().slice(0, 10);
}

function formatIso(year: number, month: number, day: number): string {
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 筛选管道：status → area → search → date（AND 组合；F2.7 一套管道两处渲染） */
export function applyFilters(items: ProjectItem[], state: FilterState): ProjectItem[] {
	let result = items;

	if (state.statuses.length > 0) {
		result = result.filter(
			(item) => item.status !== null && state.statuses.includes(item.status),
		);
	}

	result = filterByArea(result, state);
	result = filterBySearch(result, state.search);
	result = filterByDateRange(result, state.dateRange);

	return result;
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

function filterByDateRange(items: ProjectItem[], range: DateRangeState): ProjectItem[] {
	const resolved =
		range.preset === "custom"
			? { start: range.start, end: range.end }
			: resolveDateRange(range.preset, todayIso());
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

/** ISO 今天（dateRange 非 custom 预设用；生产环境由视图层日期驱动刷新） */
function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

/** 排序（F2.6）：不修改原数组 */
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
