import { ZoomMode } from "../types";
import { addDaysIso, daysInMonth, diffDaysIso, formatIso, parseIso } from "../utils/date";

/**
 * 甘特时间轴刻度（SPEC §4 F1.2）—— 纯函数，零 DOM。
 *
 * 自绘甘特的地基：把「日期」映射成「像素 x」，反之亦然（拖拽写回要用逆映射）。
 * 全部 UTC 运算，避免本地时区 DST 导致刻度错位。
 *
 * 设计取舍：
 * - 刻度范围按当前缩放级别向两侧各扩一个最小单位（日/周/月），让首尾任务条不完全贴边；
 * - 两级表头（upper 粗粒度 / lower 细粒度），与常见甘特观感一致；
 * - 周起始沿用现有脚本行为 = 周日。
 */

export type ScaleUnit = "day" | "week" | "month" | "year";

export interface ScaleColumn {
	key: string;
	label: string;
	startIso: string;
	endIso: string;
	x: number;
	width: number;
}

export interface TimeScale {
	startIso: string;
	endIso: string;
	/** 一天的像素宽度（缩放结果） */
	dayWidth: number;
	totalWidth: number;
	upper: ScaleColumn[];
	lower: ScaleColumn[];
	/** 今天的竖线位置（不在范围内为 null） */
	todayX: number | null;
	/** 日期 → 任务条左边缘 x */
	xForDate(iso: string): number;
	/** 日期 → 任务条右边缘 x（含当天，闭区间语义） */
	endXForDate(iso: string): number;
	/** x → 日期（拖拽落点反推，四舍五入到天） */
	dateForX(x: number): string;
}

/** 各缩放级别的日宽（px）。day 看得清单日，month 一屏能放下两三年。 */
export const DAY_WIDTH: Record<ZoomMode, number> = {
	day: 34,
	week: 14,
	month: 5,
};

/** 缩放级别 → 细粒度单位 */
const LOWER_UNIT: Record<ZoomMode, ScaleUnit> = {
	day: "day",
	week: "week",
	month: "month",
};

/** 缩放级别 → 粗粒度单位 */
const UPPER_UNIT: Record<ZoomMode, ScaleUnit> = {
	day: "month",
	week: "month",
	month: "year",
};

function unitStart(iso: string, unit: ScaleUnit): string {
	const { year, month, day } = parseIso(iso);
	switch (unit) {
		case "day":
			return iso;
		case "week": {
			// 周日起始（脚本行为）
			const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
			return addDaysIso(iso, -dow);
		}
		case "month":
			return formatIso(year, month, 1);
		case "year":
			return formatIso(year, 1, 1);
	}
}

function unitEnd(iso: string, unit: ScaleUnit): string {
	const { year, month } = parseIso(iso);
	switch (unit) {
		case "day":
			return iso;
		case "week":
			return addDaysIso(iso, 6);
		case "month":
			return formatIso(year, month, daysInMonth(year, month));
		case "year":
			return formatIso(year, 12, 31);
	}
}

function nextUnitStart(iso: string, unit: ScaleUnit): string {
	const { year, month } = parseIso(iso);
	switch (unit) {
		case "day":
			return addDaysIso(iso, 1);
		case "week":
			return addDaysIso(iso, 7);
		case "month": {
			const nextMonth = month === 12 ? 1 : month + 1;
			const nextYear = month === 12 ? year + 1 : year;
			return formatIso(nextYear, nextMonth, 1);
		}
		case "year":
			return formatIso(year + 1, 1, 1);
	}
}

function unitLabel(iso: string, unit: ScaleUnit): string {
	const { year, month, day } = parseIso(iso);
	switch (unit) {
		case "day":
			return String(day);
		case "week":
			return `${month}/${day}`;
		case "month":
			return formatIso(year, month, 1).slice(0, 7);
		case "year":
			return String(year);
	}
}

/** 生成覆盖 [from, to] 的刻度列（from/to 已对齐单位边界） */
function buildColumns(
	from: string,
	to: string,
	unit: ScaleUnit,
	scaleStart: string,
	dayWidth: number,
): ScaleColumn[] {
	const columns: ScaleColumn[] = [];
	let cursor = unitStart(from, unit);
	// 上限保护：极端范围（如 100 年 × 日刻度）不至于把主线程卡死
	const maxColumns = 4000;
	while (cursor <= to && columns.length < maxColumns) {
		const colStart = cursor;
		const colEnd = unitEnd(colStart, unit);
		const clampedEnd = colEnd > to ? to : colEnd;
		const x = diffDaysIso(scaleStart, colStart) * dayWidth;
		const width = (diffDaysIso(colStart, clampedEnd) + 1) * dayWidth;
		columns.push({
			key: `${unit}:${colStart}`,
			label: unitLabel(colStart, unit),
			startIso: colStart,
			endIso: clampedEnd,
			x,
			width,
		});
		cursor = nextUnitStart(colStart, unit);
		if (colEnd >= to) break;
	}
	return columns;
}

export function buildTimeScale(
	rangeStart: string,
	rangeEnd: string,
	zoom: ZoomMode,
	options: { today?: string | null } = {},
): TimeScale {
	const lowerUnit = LOWER_UNIT[zoom];
	const upperUnit = UPPER_UNIT[zoom];
	const dayWidth = DAY_WIDTH[zoom];

	// 归一化区间（调用方可能传反）
	const [from, to] = rangeStart <= rangeEnd ? [rangeStart, rangeEnd] : [rangeEnd, rangeStart];

	// 向两侧各扩一个完整细粒度单位（月/周/日），首尾任务条不至于贴死在边缘
	const startIso = unitStart(addDaysIso(unitStart(from, lowerUnit), -1), lowerUnit);
	const endIso = unitEnd(addDaysIso(unitEnd(unitStart(to, lowerUnit), lowerUnit), 1), lowerUnit);

	const totalDays = diffDaysIso(startIso, endIso) + 1;
	const totalWidth = totalDays * dayWidth;

	const lower = buildColumns(startIso, endIso, lowerUnit, startIso, dayWidth);
	const upper = buildColumns(startIso, endIso, upperUnit, startIso, dayWidth);

	const today = options.today ?? null;
	const todayInRange =
		today !== null && today >= startIso && today <= endIso ? today : null;

	return {
		startIso,
		endIso,
		dayWidth,
		totalWidth,
		upper,
		lower,
		todayX: todayInRange !== null ? diffDaysIso(startIso, todayInRange) * dayWidth + dayWidth / 2 : null,
		xForDate: (iso: string) => diffDaysIso(startIso, iso) * dayWidth,
		endXForDate: (iso: string) => (diffDaysIso(startIso, iso) + 1) * dayWidth,
		dateForX: (x: number) => addDaysIso(startIso, Math.floor(x / dayWidth)),
	};
}
