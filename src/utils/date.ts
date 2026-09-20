/**
 * 日期工具（纯函数）—— 索引规范化后的日期一律是 ISO `YYYY-MM-DD`。
 *
 * 为什么全部走 UTC 运算：甘特坐标、日期区间交集、±7 天兜底都要求确定性；
 * 本地时区的 DST 切换会让「加一天」漂移。UTC 运算无 DST，跨平台结果一致。
 * 唯一例外是 `todayIso()`——「今天」必须按用户本地日历取，否则 UTC+8 的清晨会算成前一天。
 */

/** 补零格式化（不校验合法性；输入合法性由 normalize 层保证） */
export function formatIso(year: number, month: number, day: number): string {
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface DateParts {
	year: number;
	month: number;
	day: number;
}

/** 解析 ISO `YYYY-MM-DD`（调用方需保证已规范化） */
export function parseIso(iso: string): DateParts {
	return {
		year: Number(iso.slice(0, 4)),
		month: Number(iso.slice(5, 7)),
		day: Number(iso.slice(8, 10)),
	};
}

/** 严格校验 ISO `YYYY-MM-DD` 且为真实日历日期（含闰年） */
export function isValidIso(iso: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
	const { year, month, day } = parseIso(iso);
	if (month < 1 || month > 12) return false;
	if (day < 1 || day > daysInMonth(year, month)) return false;
	return true;
}

/** 该月天数 */
export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 加减天数（跨月/跨年自动进位） */
export function addDaysIso(iso: string, days: number): string {
	const { year, month, day } = parseIso(iso);
	const date = new Date(Date.UTC(year, month - 1, day + days));
	return formatIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** to - from 的天数差（可为负） */
export function diffDaysIso(fromIso: string, toIso: string): number {
	const from = parseIso(fromIso);
	const to = parseIso(toIso);
	const fromMs = Date.UTC(from.year, from.month - 1, from.day);
	const toMs = Date.UTC(to.year, to.month - 1, to.day);
	return Math.round((toMs - fromMs) / 86_400_000);
}

/** 本地日历的今天（用户视角的「今天」，非 UTC 今天） */
export function todayIso(): string {
	const now = new Date();
	return formatIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** ISO 字符串比较（同格式下字典序即时间序，闭区间边界判断用严格比较即可） */
export function compareIso(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** 取两者较早/较晚（null 视为不存在） */
export function minIso(a: string | null, b: string | null): string | null {
	if (a === null) return b;
	if (b === null) return a;
	return a < b ? a : b;
}

export function maxIso(a: string | null, b: string | null): string | null {
	if (a === null) return b;
	if (b === null) return a;
	return a > b ? a : b;
}
