import {
	normalizeBoolean,
	normalizeDate,
	normalizeProgress,
	normalizeStatus,
	normalizeStringArray,
} from "./normalize";
import { ProjectItem, ProjectMasterSettings } from "../types";

/**
 * 项目条目构建（SPEC §2.1–§2.3）—— 纯函数。
 * 识别：type 字段 == "project" 或 tags 含 identifyTag；
 * 规范化只读不改写：非法值收集为 issues 供 UI 提示修复，缺失值为 null。
 */

/** type 字段的识别值（协议常量，与现有脚本 `p.type === "project"` 一致） */
const TYPE_PROJECT_VALUE = "project";

/** 数据问题（UI「请修复」提示的数据源；reason 机器可读，文案由视图层映射） */
export interface DataIssue {
	/** 逻辑字段名（FieldMappingConfig 的键） */
	field: string;
	reason: "unknown-status" | "invalid-date";
	/** 用户写入的原始值（仅用于展示） */
	raw: string;
}

export interface ProjectFileInfo {
	path: string;
	name: string;
	folder: string;
}

export interface BuildResult {
	/** 非项目笔记为 null；识别成功但部分字段非法时仍返回 item（字段为 null + issues） */
	item: ProjectItem | null;
	issues: DataIssue[];
}

export function buildProjectItem(
	frontmatter: Record<string, unknown> | null | undefined,
	file: ProjectFileInfo,
	settings: ProjectMasterSettings,
): BuildResult {
	const fm = frontmatter ?? {};
	const mapping = settings.fieldMapping;
	const issues: DataIssue[] = [];

	// tags 为 Obsidian 原生字段，物理名固定，不进入字段映射表
	const tags = normalizeStringArray(fm["tags"]);
	const isTypeMatch =
		typeof fm[mapping.type] === "string" &&
		(fm[mapping.type] as string).trim().toLowerCase() === TYPE_PROJECT_VALUE;
	const isTagMatch = tags.includes(mapping.identifyTag);
	if (!isTypeMatch && !isTagMatch) {
		return { item: null, issues: [] };
	}

	const status = normalizeStatus(fm[mapping.status], settings.chineseAliasCompat);
	if (status === null && fm[mapping.status] !== undefined && fm[mapping.status] !== null) {
		issues.push({
			field: "status",
			reason: "unknown-status",
			raw: String(fm[mapping.status]),
		});
	}

	const startDate = parseDateField(fm[mapping.startDate], "startDate", issues);
	const dueDate = parseDateField(fm[mapping.dueDate], "dueDate", issues)
		?? (fm[mapping.dueDate] === undefined
			? parseDateField(fm[mapping.endDateFallback], "dueDate", issues)
			: null);
	const completionDate = parseDateField(
		fm[mapping.completionDate],
		"completionDate",
		issues,
	);

	const item: ProjectItem = {
		status,
		startDate,
		dueDate,
		completionDate,
		progress: normalizeProgress(fm[mapping.progress]),
		priority: normalizeOptionalString(fm[mapping.priority]),
		area: normalizeStringArray(fm[mapping.area]),
		objective: normalizeOptionalString(fm[mapping.objective]),
		context: normalizeOptionalString(fm[mapping.context]),
		longTerm: normalizeBoolean(fm[mapping.longTerm]),
		mainProject: normalizeBoolean(fm[mapping.mainProject]),
		projectId: normalizeOptionalString(fm[mapping.projectId]),
		projectLeader: normalizeOptionalString(fm[mapping.projectLeader]),
		projectMembers: normalizeStringArray(fm[mapping.projectMembers]),
		tags,
		file,
	};

	return { item, issues };
}

/**
 * 日期字段解析：invalid → issue + null（缺失不 fallback：字段"没写"才走兜底链，
 * "写了但坏"必须显式暴露，不静默纠正——SPEC §2.3）。
 */
function parseDateField(
	raw: unknown,
	logicalField: string,
	issues: DataIssue[],
): string | null {
	const parsed = normalizeDate(raw);
	if (parsed === null) return null;
	if (parsed.kind === "invalid") {
		issues.push({ field: logicalField, reason: "invalid-date", raw: parsed.raw });
		return null;
	}
	return parsed.iso;
}

function normalizeOptionalString(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const value = raw.trim();
	return value.length > 0 ? value : null;
}
