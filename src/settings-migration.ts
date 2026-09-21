import {
	BAR_DURATION_MODES,
	CARD_FONT_SCALE_RANGE,
	DEFAULT_FIELD_MAPPING,
	DEFAULT_GANTT_BAR_COLORS,
	DEFAULT_SETTINGS,
	FieldMappingConfig,
	GanttBarColors,
	GROUPING_MODES,
	HolidayScheduleMap,
	PROJECT_STATUSES,
	ProjectMasterSettings,
	ProjectStatus,
	SETTINGS_VERSION,
	SIDEBAR_WIDTH_RANGE,
	SORT_MODES,
	ZOOM_MODES,
} from "./types";

/**
 * 设置迁移与清洗（SPEC §5.5）—— 纯函数。
 *
 * 两条硬约束（技能 compatibility.md + SPEC §8）：
 * 1. **可重复执行**：migrate(migrate(x)) 与 migrate(x) 结果一致（幂等）。
 * 2. **失败保留原数据**：本函数是「全函数」——永不抛异常，逐字段降级到默认值。
 *    某个字段损坏只损失该字段，不会把整份配置重置掉。
 *
 * 枚举白名单不在这里手写：它们从 `types.ts` 的 `Record<T, true>` 派生，
 * 漏写成员会编译报错（这个位置曾经静静漏掉过 `year`）。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 非空字符串数组（去空白、剔除非字符串、保序去重） */
function stringArray(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") continue;
		const trimmed = entry.trim();
		if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed);
	}
	return out;
}

function nonEmptyString(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: T[], fallback: T): T {
	return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

/** 0 以上的整数（maxNotesPerProject 的 0 = 不限） */
function nonNegativeInt(value: unknown, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.trunc(value);
	return fallback;
}

/** 映射表清洗：只保留「字符串键 → 允许值」的成员（设置页导入复用同一实现） */
export function statusAliasMap(value: unknown): Record<string, ProjectStatus> | null {
	if (!isRecord(value)) return null;
	const out: Record<string, ProjectStatus> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw !== "string") continue;
		if (!(PROJECT_STATUSES as string[]).includes(raw)) continue;
		if (key.trim().length === 0) continue;
		out[key] = raw as ProjectStatus;
	}
	return out;
}

/**
 * 「字符串 → 字符串数组」映射清洗（手动排序用）。
 * 逐项降级：坏掉的那一项丢掉，不影响其他分组的手动顺序。
 */
function pathListMap(value: unknown): Record<string, string[]> {
	if (!isRecord(value)) return {};
	const out: Record<string, string[]> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (key.trim().length === 0) continue;
		const list = stringArray(raw);
		if (list === null || list.length === 0) continue;
		out[key] = list;
	}
	return out;
}

/**
 * 年度节假日排期清洗：只保留「四位年份 → 两个字符串字段」的条目。
 *
 * 键必须是四位数字、值必须是对象，否则整条丢掉——排期是要拿去展开成日期清单的，
 * 放进不可解析的东西只会在导出时变成一句莫名其妙的 mermaid 指令。
 */
export function holidayScheduleMap(value: unknown): HolidayScheduleMap | null {
	if (!isRecord(value)) return null;
	const out: HolidayScheduleMap = {};
	for (const [key, raw] of Object.entries(value)) {
		if (!/^\d{4}$/.test(key)) continue;
		if (!isRecord(raw)) continue;
		out[key] = {
			holidays: typeof raw.holidays === "string" ? raw.holidays : "",
			makeupWorkdays: typeof raw.makeupWorkdays === "string" ? raw.makeupWorkdays : "",
		};
	}
	return out;
}

/** 只保留字符串值成员的映射表（设置页导入复用） */
export function stringMap(value: unknown): Record<string, string> | null {
	if (!isRecord(value)) return null;
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw !== "string") continue;
		if (key.trim().length === 0) continue;
		out[key] = raw;
	}
	return out;
}

/** status 顺序：过滤非法值；去重；结果为空则退回默认顺序 */
function statusOrderList(value: unknown): ProjectStatus[] {
	const filtered = Array.isArray(value)
		? value.filter(
				(entry): entry is ProjectStatus =>
					typeof entry === "string" && (PROJECT_STATUSES as string[]).includes(entry),
			)
		: [];
	const deduped = [...new Set(filtered)];
	return deduped.length > 0 ? deduped : [...PROJECT_STATUSES];
}

/**
 * 侧栏宽度：`null` / 非法 → `null`（回到默认占比）；有效值收敛到区间内。
 *
 * 越界**收敛**而不是丢弃：用户拖到区间上限时窗口只有 700，存 900 是合理意图，
 * 换回大窗口就该是 900——丢弃的话换个窗口宽度就「莫名其妙变回默认」。
 */
function sidebarWidth(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	const { min, max } = SIDEBAR_WIDTH_RANGE;
	return Math.min(Math.max(Math.round(value), min), max);
}

/** 字段映射清洗：逻辑字段名固定，物理字段名逐项校验 */
function fieldMapping(value: unknown): FieldMappingConfig {
	if (!isRecord(value)) return { ...DEFAULT_FIELD_MAPPING };
	const out = { ...DEFAULT_FIELD_MAPPING };
	for (const key of Object.keys(DEFAULT_FIELD_MAPPING) as (keyof FieldMappingConfig)[]) {
		out[key] = nonEmptyString(value[key], DEFAULT_FIELD_MAPPING[key]);
	}
	return out;
}

/**
 * 面板卡片字号缩放（百分比整数）：非数字 / 越界一律退回默认。
 *
 * 越界当**无效**而不是夹到边界：把 900 悄悄变成 220，用户只会以为自己没改对。
 */
function cardFontScale(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_SETTINGS.cardFontScale;
	}
	const rounded = Math.round(value);
	return rounded >= CARD_FONT_SCALE_RANGE.min && rounded <= CARD_FONT_SCALE_RANGE.max
		? rounded
		: DEFAULT_SETTINGS.cardFontScale;
}

/** 甘特条配色清洗：四项各自判空，坏掉的那一项退回默认，其余原样保留 */
function ganttBarColors(value: unknown): GanttBarColors {
	if (!isRecord(value)) return { ...DEFAULT_GANTT_BAR_COLORS };
	const out = { ...DEFAULT_GANTT_BAR_COLORS };
	for (const key of Object.keys(DEFAULT_GANTT_BAR_COLORS) as (keyof GanttBarColors)[]) {
		out[key] = nonEmptyString(value[key], DEFAULT_GANTT_BAR_COLORS[key]);
	}
	return out;
}

/**
 * 把任意来源的数据（旧版本 data.json / 损坏文件 / null）清洗成当前版本的完整设置。
 * 幂等：对已迁移数据再次调用不产生变化。
 */
export function migrateSettings(raw: unknown): ProjectMasterSettings {
	const source = isRecord(raw) ? raw : {};

	return {
		version: SETTINGS_VERSION,
		scanFolders: stringArray(source.scanFolders) ?? [...DEFAULT_SETTINGS.scanFolders],
		// 允许留空（用户口径 2026-09-20）：空 = 只认扫描目录根层的项目为快速项目
		quickProjectMarker:
			typeof source.quickProjectMarker === "string"
				? source.quickProjectMarker.trim()
				: DEFAULT_SETTINGS.quickProjectMarker,
		excludedFolders: stringArray(source.excludedFolders) ?? [...DEFAULT_SETTINGS.excludedFolders],
		chineseAliasCompat:
			typeof source.chineseAliasCompat === "boolean"
				? source.chineseAliasCompat
				: DEFAULT_SETTINGS.chineseAliasCompat,
		dateFallback: enumValue(
			source.dateFallback,
			["offset7", "mark-invalid"] as const,
			DEFAULT_SETTINGS.dateFallback,
		),
		dateFallbackDays: nonNegativeInt(source.dateFallbackDays, DEFAULT_SETTINGS.dateFallbackDays),
		fieldMapping: fieldMapping(source.fieldMapping),
		ganttBarColors: ganttBarColors(source.ganttBarColors),
		cardFontScale: cardFontScale(source.cardFontScale),
		sidebarWidth: sidebarWidth(source.sidebarWidth),
		// 界面语言：认不出的值退回 auto（跟随宿主），不会因为写错就把界面锁死在某一语言
		uiLanguage: enumValue(
			source.uiLanguage,
			["auto", "zh", "en"] as const,
			DEFAULT_SETTINGS.uiLanguage,
		),
		statusAliases: statusAliasMap(source.statusAliases) ?? { ...DEFAULT_SETTINGS.statusAliases },
		statusEmoji: stringMap(source.statusEmoji) ?? { ...DEFAULT_SETTINGS.statusEmoji },
		statusOrder: statusOrderList(source.statusOrder),
		priorityEmoji: stringMap(source.priorityEmoji) ?? { ...DEFAULT_SETTINGS.priorityEmoji },
		defaultGrouping: enumValue(
			source.defaultGrouping,
			GROUPING_MODES,
			DEFAULT_SETTINGS.defaultGrouping,
		),
		defaultSort: enumValue(source.defaultSort, SORT_MODES, DEFAULT_SETTINGS.defaultSort),
		defaultZoom: enumValue(source.defaultZoom, ZOOM_MODES, DEFAULT_SETTINGS.defaultZoom),
		defaultYearFilter: enumValue(
			source.defaultYearFilter,
			["current", "none"] as const,
			DEFAULT_SETTINGS.defaultYearFilter,
		),
		maxNotesPerProject: nonNegativeInt(
			source.maxNotesPerProject,
			DEFAULT_SETTINGS.maxNotesPerProject,
		),
		/*
		 * 允许留空（用户口径 2026-09-20）：空 = 不建子文件夹，资料与项目文档同目录。
		 * 只有类型不对/缺失才退回默认值——原来用 nonEmptyString 会把空串也退回「资料」，
		 * 于是用户根本删不掉它。
		 */
		materialsFolderName:
			typeof source.materialsFolderName === "string"
				? source.materialsFolderName.trim()
				: DEFAULT_SETTINGS.materialsFolderName,
		// 与 mermaidExcludeDates 同口径：允许为空（空 = 不用模板），只做去空白
		newProjectTemplate:
			typeof source.newProjectTemplate === "string" ? source.newProjectTemplate.trim() : "",
		mermaidTitle: nonEmptyString(source.mermaidTitle, DEFAULT_SETTINGS.mermaidTitle),
		mermaidTodayMarker:
			typeof source.mermaidTodayMarker === "boolean"
				? source.mermaidTodayMarker
				: DEFAULT_SETTINGS.mermaidTodayMarker,
		mermaidExcludeWeekends:
			typeof source.mermaidExcludeWeekends === "boolean"
				? source.mermaidExcludeWeekends
				: DEFAULT_SETTINGS.mermaidExcludeWeekends,
		mermaidExcludeDates:
			typeof source.mermaidExcludeDates === "string" ? source.mermaidExcludeDates : "",
		mermaidIncludeDates:
			typeof source.mermaidIncludeDates === "string" ? source.mermaidIncludeDates : "",
		holidaySchedules: holidayScheduleMap(source.holidaySchedules) ?? {},
		ganttBarDuration: enumValue(
			source.ganttBarDuration,
			BAR_DURATION_MODES,
			DEFAULT_SETTINGS.ganttBarDuration,
		),
		manualGroupOrder: pathListMap(source.manualGroupOrder),
		manualProjectOrder: pathListMap(source.manualProjectOrder),
		mermaidSectionFallback: nonEmptyString(
			source.mermaidSectionFallback,
			DEFAULT_SETTINGS.mermaidSectionFallback,
		),
		mermaidMarkerStart: nonEmptyString(
			source.mermaidMarkerStart,
			DEFAULT_SETTINGS.mermaidMarkerStart,
		),
		mermaidMarkerEnd: nonEmptyString(source.mermaidMarkerEnd, DEFAULT_SETTINGS.mermaidMarkerEnd),
	};
}

/**
 * 运行时（vault 相关）参数补充：Obsidian 配置目录名可能被用户改过，
 * 不能硬编码 `.obsidian`，必须在拿到 Vault#configDir 后并入排除项。
 */
export function withConfigDir(
	settings: ProjectMasterSettings,
	configDir: string,
): ProjectMasterSettings {
	if (configDir.length === 0 || settings.excludedFolders.includes(configDir)) {
		return settings;
	}
	return { ...settings, excludedFolders: [...settings.excludedFolders, configDir] };
}
