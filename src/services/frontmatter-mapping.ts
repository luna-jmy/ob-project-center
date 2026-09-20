import {
	FieldMappingConfig,
	ProjectItem,
	ProjectStatus,
} from "../types";

/**
 * 编辑表单 ↔ frontmatter 的映射（SPEC §5.2 单一映射层）—— 纯函数。
 *
 * 这里是「逻辑字段名 → 物理字段名」的唯一翻译点：编辑 Modal、新建 Modal、
 * 拖拽写回都经此转换，物理字段名绝不出现在 UI 代码里（agent.md §2.5 参数分离）。
 *
 * 空值语义（与 processFrontMatter 的 patch 约定一致）：
 * `null` = 删除该字段；`undefined` 不会出现；布尔与数组总是写入（它们是模板的常驻字段）。
 */

export interface EditorValues {
	status: ProjectStatus | null;
	priority: string | null;
	startDate: string | null;
	dueDate: string | null;
	completionDate: string | null;
	progress: number | null;
	area: string[];
	objective: string | null;
	projectLeader: string | null;
	projectMembers: string[];
	longTerm: boolean;
	mainProject: boolean;
}

export function emptyEditorValues(): EditorValues {
	return {
		status: null,
		priority: null,
		startDate: null,
		dueDate: null,
		completionDate: null,
		progress: null,
		area: [],
		objective: null,
		projectLeader: null,
		projectMembers: [],
		longTerm: false,
		mainProject: false,
	};
}

/** 索引条目 → 表单初值（编辑 Modal 打开时用） */
export function editorValuesFromItem(item: ProjectItem): EditorValues {
	return {
		status: item.status,
		priority: item.priority,
		startDate: item.startDate,
		dueDate: item.dueDate,
		completionDate: item.completionDate,
		progress: item.progress,
		area: [...item.area],
		objective: item.objective,
		projectLeader: item.projectLeader,
		projectMembers: [...item.projectMembers],
		longTerm: item.longTerm,
		mainProject: item.mainProject,
	};
}

/**
 * 表单 → frontmatter patch。
 *
 * 三类字段的写入语义各不相同，这是刻意的：
 * - 标量（status/priority/日期/进度/文本）：空 → null（删除字段，保持 frontmatter 干净）；
 * - 列表（area/project-members）：空列表 → null（删除），非空 → 数组；
 * - 布尔（long-term / main-project）：**总是**写 true/false。
 *   它们在模板里是常驻字段，「关掉开关」应当写 false 而不是删字段——
 *   删了以后重新套模板又是 true，用户会觉得开关没生效。
 */
export function buildProjectPatch(
	values: EditorValues,
	mapping: FieldMappingConfig,
): Record<string, unknown> {
	return {
		[mapping.status]: values.status,
		[mapping.priority]: values.priority,
		[mapping.startDate]: values.startDate,
		[mapping.dueDate]: values.dueDate,
		[mapping.completionDate]: values.completionDate,
		[mapping.progress]: values.progress,
		[mapping.area]: values.area.length > 0 ? values.area : null,
		[mapping.objective]: values.objective,
		[mapping.projectLeader]: values.projectLeader,
		[mapping.projectMembers]:
			values.projectMembers.length > 0 ? values.projectMembers : null,
		[mapping.longTerm]: values.longTerm,
		[mapping.mainProject]: values.mainProject,
	};
}

/**
 * 新建项目 patch（F4.1）：项目 patch + 识别标志。
 * `tags` 是 Obsidian 原生字段、物理名固定，不参与字段映射表。
 */
export function buildNewProjectPatch(
	values: EditorValues,
	mapping: FieldMappingConfig,
): Record<string, unknown> {
	return {
		...buildProjectPatch(values, mapping),
		[mapping.type]: "project",
		tags: [mapping.identifyTag],
	};
}

/** 逗号（中英文）或换行分隔的输入 → 字符串数组（去空白、去重、保序） */
export function parseListInput(raw: string): string[] {
	const out: string[] = [];
	for (const chunk of raw.split(/[,，\n]/)) {
		const value = chunk.trim();
		if (value.length > 0 && !out.includes(value)) out.push(value);
	}
	return out;
}

export function formatListInput(list: string[]): string {
	return list.join(", ");
}

/** 输入框 → 日期：空串/null → null（触发删除）；其余原样交给 Obsidian 校验 */
export function parseDateInput(raw: string | null | undefined): string | null {
	if (raw === null || raw === undefined) return null;
	const value = raw.trim();
	return value.length === 0 ? null : value;
}

/** 输入框 → 数字：空串 → null；非法数字 → null（不写坏数据） */
export function parseNumberInput(raw: string, min: number, max: number): number | null {
	const value = raw.trim();
	if (value.length === 0) return null;
	if (!/^-?\d+$/.test(value)) return null;
	return Math.min(max, Math.max(min, Number(value)));
}
