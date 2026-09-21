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
	/** 领域：单值（分组维度，多值会让分组失效，用户口径 2026-09-21） */
	area: string | null;
	objective: string | null;
	projectLeader: string | null;
	projectMembers: string[];
	/** 多行备注（用户口径 2026-09-21） */
	remark: string | null;
	longTerm: boolean;
	mainProject: boolean;
	/** 甘特条自定义颜色（CSS 颜色值） */
	color: string | null;
}

/**
 * 编辑弹窗里"已有值"候选（用户口径 2026-09-21）。
 *
 * 目的不是加个下拉好看，而是**字段内容一致性**：领域、目标、负责人这些字段一旦同时
 * 出现「市场」和「市场部」，分组与筛选就悄悄裂成两拨，而且从界面上看不出为什么。
 * 候选值只来自**库里已经写过的值**，让人尽量选、少手打。
 */
export interface FieldSuggestions {
	area: string[];
	objective: string[];
	projectLeader: string[];
	projectMembers: string[];
}

export function emptyEditorValues(): EditorValues {
	return {
		status: null,
		priority: null,
		startDate: null,
		dueDate: null,
		completionDate: null,
		progress: null,
		area: null,
		objective: null,
		projectLeader: null,
		projectMembers: [],
		remark: null,
		longTerm: false,
		mainProject: false,
		color: null,
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
		area: item.area,
		objective: item.objective,
		projectLeader: item.projectLeader,
		projectMembers: [...item.projectMembers],
		remark: item.remark,
		longTerm: item.longTerm,
		mainProject: item.mainProject,
		color: item.color,
	};
}

/**
 * 表单 → frontmatter patch。
 *
 * 三类字段的写入语义各不相同，这是刻意的：
 * - 标量（status/priority/日期/进度/文本/领域）：空 → null（删除字段，保持 frontmatter 干净）；
 * - 列表（project-members）：空列表 → null（删除），非空 → 数组；
 *   （领域原先是列表，2026-09-21 改成标量：它是分组维度，多值会让分组失效。）
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
		[mapping.area]: values.area,
		[mapping.objective]: values.objective,
		[mapping.projectLeader]: values.projectLeader,
		[mapping.projectMembers]:
			values.projectMembers.length > 0 ? values.projectMembers : null,
		[mapping.remark]: values.remark,
		[mapping.longTerm]: values.longTerm,
		[mapping.mainProject]: values.mainProject,
		[mapping.color]: values.color,
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

/**
 * 已有值候选：从全部项目里收集（去空白、去重、按码点排序）。
 *
 * 排序用码点而不是 localeCompare("zh")：与仓库其它排序一致，跨环境结果确定。
 * 顺序稳定这件事对下拉/标签有实际意义——同一个 vault 每次打开看到的顺序应当一样。
 */
export function collectSuggestions(items: readonly ProjectItem[]): FieldSuggestions {
	const area = new Set<string>();
	const objective = new Set<string>();
	const projectLeader = new Set<string>();
	const projectMembers = new Set<string>();
	for (const item of items) {
		addValue(area, item.area);
		addValue(objective, item.objective);
		addValue(projectLeader, item.projectLeader);
		for (const value of item.projectMembers) addValue(projectMembers, value);
	}
	return {
		area: sortedValues(area),
		objective: sortedValues(objective),
		projectLeader: sortedValues(projectLeader),
		projectMembers: sortedValues(projectMembers),
	};
}

function addValue(target: Set<string>, value: string | null): void {
	const trimmed = (value ?? "").trim();
	if (trimmed.length > 0) target.add(trimmed);
}

function sortedValues(values: Set<string>): string[] {
	return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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
