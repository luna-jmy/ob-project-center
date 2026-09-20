import { PROJECT_STATUSES, STATUS_CHINESE_ALIASES, ProjectStatus } from "../types";

/**
 * 数据规范化层（SPEC §2.3）—— 纯函数，零 Obsidian 依赖。
 * 只读不改写用户数据；非法值显式标记（invalid），缺失值返回 null，两者严格区分。
 */

/** 日期解析结果：ok / invalid（附原始值供 UI 提示修复）/ null（字段缺失） */
export type ParsedDate =
	| { kind: "ok"; iso: string }
	| { kind: "invalid"; raw: string }
	| null;

/**
 * status 规范化：英文枚举直通；中文别名按开关映射；其余 null。
 * @param aliases 别名映射表（SPEC §5.3 可被设置覆盖）；省略时用模板默认表
 */
export function normalizeStatus(
	raw: unknown,
	chineseAliasCompat: boolean,
	aliases: Readonly<Record<string, ProjectStatus>> = STATUS_CHINESE_ALIASES,
): ProjectStatus | null {
	if (typeof raw !== "string") return null;
	const value = raw.trim();
	const canonical = value.toLowerCase() as ProjectStatus;
	if ((PROJECT_STATUSES as readonly string[]).includes(canonical)) {
		return canonical;
	}
	if (chineseAliasCompat) {
		const aliased = aliases[value];
		if (aliased !== undefined) return aliased;
	}
	return null;
}

/**
 * 日期容错解析 → 统一 ISO（YYYY-MM-DD）。
 * 支持：YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD、紧凑 YYYYMMDD（字符串或数字）。
 * 日历合法性校验（含闰年）；不合法 → invalid，不静默纠正。
 */
export function normalizeDate(raw: unknown): ParsedDate {
	if (raw === undefined || raw === null) return null;

	let text: string;
	if (typeof raw === "number" && Number.isFinite(raw)) {
		text = String(Math.trunc(raw));
	} else if (typeof raw === "string") {
		text = raw.trim();
	} else {
		return { kind: "invalid", raw: describeRaw(raw) };
	}
	if (text.length === 0) {
		return { kind: "invalid", raw: text };
	}

	const match =
		/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text) ??
		(/^(\d{4})(\d{2})(\d{2})$/.exec(text) ??
			(/^(\d{4})[-/.](\d{1,2})$/.exec(text) ??
				/^(\d{4})[-/.](\d{1,2})[-/.]$/.exec(text)));
	if (match === null) {
		return { kind: "invalid", raw: text };
	}

	const year = Number(match[1]);
	const month = Number(match[2] ?? 1);
	const day = Number(match[3] ?? 1);
	if (!isValidCalendarDate(year, month, day)) {
		return { kind: "invalid", raw: text };
	}
	return { kind: "ok", iso: formatIso(year, month, day) };
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
	if (month < 1 || month > 12) return false;
	if (day < 1) return false;
	const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return day <= daysInMonth[month - 1];
}

function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function formatIso(year: number, month: number, day: number): string {
	const y = String(year).padStart(4, "0");
	const m = String(month).padStart(2, "0");
	const d = String(day).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** 非标量值转可读描述（避免 [object Object]） */
function describeRaw(raw: unknown): string {
	if (typeof raw === "object" && raw !== null) {
		try {
			return JSON.stringify(raw) ?? "[unserializable]";
		} catch {
			return "[unserializable]";
		}
	}
	return String(raw);
}

/** 单值/数组统一为字符串数组（去空白、剔除非字符串成员）。 */
export function normalizeStringArray(raw: unknown): string[] {
	if (raw === undefined || raw === null) return [];
	const list = Array.isArray(raw) ? raw : [raw];
	return list
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

/** progress 规范化：数字/数字串（含 % 后缀）→ clamp 0..100；非数值 null。 */
export function normalizeProgress(raw: unknown): number | null {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return clamp(Math.trunc(raw));
	}
	if (typeof raw === "string") {
		const text = raw.trim().replace(/%$/, "").trim();
		if (/^-?\d+$/.test(text)) {
			return clamp(Number(text));
		}
	}
	return null;
}

function clamp(value: number): number {
	return Math.min(100, Math.max(0, value));
}

/**
 * CSS 颜色白名单校验（甘特条自定义颜色用）。
 *
 * 为什么不用浏览器解析：这里跑在纯逻辑层（零 DOM、可单测）。
 * 非法颜色不会执行代码，但会让任务条静默退回默认色——属于最难排查的那种失效，
 * 所以宁可在这里挡下来并回报给用户，也不放任它进渲染层。
 */
const COLOR_PATTERNS: readonly RegExp[] = [
	// 只认 CSS 真正合法的四位长度：3 / 4 / 6 / 8。
	// 写成 {3,8} 会把 5 位、7 位的无效 hex 也放过去，浏览器却整条丢弃
	/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
	/^rgba?\(\s*[\d.%,\s/]+\)$/i, // rgb() / rgba()
	/^hsla?\(\s*[\d.%,\s/deg]+\)$/i, // hsl() / hsla()
	/^var\(--[a-z0-9-_]+\)$/i, // var(--color-red)：跟随主题
	/^[a-z]{3,20}$/i, // 具名颜色 red / transparent
];

export function isColorLike(raw: unknown): boolean {
	if (typeof raw !== "string") return false;
	const value = raw.trim();
	if (value.length === 0) return false;
	return COLOR_PATTERNS.some((pattern) => pattern.test(value));
}

/** 布尔规范化：真布尔 / 常见字符串拼写；缺失为 false（对齐模板 long-term: false 现状）。 */
export function normalizeBoolean(raw: unknown): boolean {
	if (typeof raw === "boolean") return raw;
	if (typeof raw === "number") return raw !== 0;
	if (typeof raw === "string") {
		const value = raw.trim().toLowerCase();
		if (["true", "1", "yes"].includes(value)) return true;
		if (["false", "0", "no"].includes(value)) return false;
	}
	return false;
}
