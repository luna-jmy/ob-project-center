import {
	DEFAULT_FIELD_MAPPING,
	DEFAULT_SETTINGS,
	FieldMappingConfig,
	GroupingMode,
	PROJECT_STATUSES,
	ProjectMasterSettings,
	ProjectStatus,
	SETTINGS_VERSION,
	SortMode,
	ZoomMode,
} from "./types";

/**
 * 设置迁移与清洗（SPEC §5.5）—— 纯函数。
 *
 * 两条硬约束（技能 compatibility.md + SPEC §8）：
 * 1. **可重复执行**：migrate(migrate(x)) 与 migrate(x) 结果一致（幂等）。
 * 2. **失败保留原数据**：本函数是「全函数」——永不抛异常，逐字段降级到默认值。
 *    某个字段损坏只损失该字段，不会把整份配置重置掉。
 */

const GROUPING_MODES: GroupingMode[] = ["folder", "objective", "area"];
const SORT_MODES: SortMode[] = ["due-asc", "name", "priority"];
const ZOOM_MODES: ZoomMode[] = ["day", "week", "month"];

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
 * 把任意来源的数据（旧版本 data.json / 损坏文件 / null）清洗成当前版本的完整设置。
 * 幂等：对已迁移数据再次调用不产生变化。
 */
export function migrateSettings(raw: unknown): ProjectMasterSettings {
	const source = isRecord(raw) ? raw : {};

	return {
		version: SETTINGS_VERSION,
		scanFolders: stringArray(source.scanFolders) ?? [...DEFAULT_SETTINGS.scanFolders],
		quickProjectMarker: nonEmptyString(
			source.quickProjectMarker,
			DEFAULT_SETTINGS.quickProjectMarker,
		),
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
		hideCancelledInGantt:
			typeof source.hideCancelledInGantt === "boolean"
				? source.hideCancelledInGantt
				: DEFAULT_SETTINGS.hideCancelledInGantt,
		materialsFolderName: nonEmptyString(
			source.materialsFolderName,
			DEFAULT_SETTINGS.materialsFolderName,
		),
		mermaidTitle: nonEmptyString(source.mermaidTitle, DEFAULT_SETTINGS.mermaidTitle),
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
