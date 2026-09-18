/**
 * Project Master — 类型与设置定义（SPEC.md §2/§5 的单一事实源）
 *
 * 参数分离原则（agent.md §2.5）：
 * - 插件内部只使用逻辑字段名（FieldMappingConfig 的键）；
 * - 物理字段名（frontmatter 里的真实名字）只出现在 FieldMappingConfig 的值中；
 * - 所有业务常量必须可由设置覆盖，禁止散落硬编码。
 */

export const SETTINGS_VERSION = 1;

/** 规范化项目状态（canonical，机器值全小写英文） */
export type ProjectStatus =
	| "inbox"
	| "draft"
	| "active"
	| "on-hold"
	| "completed"
	| "cancelled"
	| "archived";

/** 全部合法状态（顺序即 suggester 顺序，对齐 TPL-Project 模板交互） */
export const PROJECT_STATUSES: ProjectStatus[] = [
	"inbox",
	"draft",
	"active",
	"on-hold",
	"completed",
	"cancelled",
	"archived",
];

/** status 中文别名 → 规范值（SPEC §2.3，仅在 chineseAliasCompat 开启时生效） */
export const STATUS_CHINESE_ALIASES: Readonly<Record<string, ProjectStatus>> = {
	"未开始/待启动": "inbox",
	"起草/构思中": "draft",
	执行中: "active",
	暂停: "on-hold",
	完成: "completed",
	取消: "cancelled",
	归档: "archived",
};

/**
 * 字段映射：逻辑字段名 → 物理字段名。
 * 默认值 = TPL-Project.md 模板现状（SPEC §5.2）。
 */
export interface FieldMappingConfig {
	type: string;
	status: string;
	priority: string;
	startDate: string;
	dueDate: string;
	endDateFallback: string;
	completionDate: string;
	progress: string;
	area: string;
	objective: string;
	context: string;
	projectLeader: string;
	projectMembers: string;
	longTerm: string;
	mainProject: string;
	projectId: string;
	/** tags 中用于补充识别项目的标签 */
	identifyTag: string;
}

export const DEFAULT_FIELD_MAPPING: FieldMappingConfig = {
	type: "type",
	status: "status",
	priority: "priority",
	startDate: "start_date",
	dueDate: "due_date",
	endDateFallback: "end_date",
	completionDate: "completion_date",
	progress: "progress",
	area: "area",
	objective: "objective",
	context: "context",
	projectLeader: "project-leader",
	projectMembers: "project-members",
	longTerm: "long-term",
	mainProject: "main-project",
	projectId: "project-id",
	identifyTag: "project",
};

export type DateFallbackStrategy = "offset7" | "mark-invalid";
export type GroupingMode = "folder" | "objective" | "area";
export type SortMode = "due-asc" | "name" | "priority";
export type ZoomMode = "day" | "week" | "month";

export interface ProjectMasterSettings {
	version: number;
	/** 项目扫描目录（多目录，SPEC §5.1） */
	scanFolders: string[];
	/** 路径含此标记的文件夹归入「快速项目」分区 */
	quickProjectMarker: string;
	/**
	 * 排除的文件夹。
	 * 注意：Obsidian 配置目录不硬编码 .obsidian（可能被用户改过），
	 * 运行时由 main.ts 用 Vault#configDir 动态并入（技能 hardcoded-config-path 规则）。
	 */
	excludedFolders: string[];
	/** status 中文别名兼容开关 */
	chineseAliasCompat: boolean;
	/** 缺失日期的兜底策略：±7 天 or 标记无效 */
	dateFallback: DateFallbackStrategy;
	fieldMapping: FieldMappingConfig;
	defaultGrouping: GroupingMode;
	defaultSort: SortMode;
	defaultZoom: ZoomMode;
	/** 每项目笔记预览条数（现有 maxNotes 行为） */
	maxNotesPerProject: number;
}

export const DEFAULT_SETTINGS: ProjectMasterSettings = {
	version: SETTINGS_VERSION,
	scanFolders: ["100 Projects"],
	quickProjectMarker: "快速项目",
	excludedFolders: ["templates"],
	chineseAliasCompat: true,
	dateFallback: "offset7",
	fieldMapping: DEFAULT_FIELD_MAPPING,
	defaultGrouping: "folder",
	defaultSort: "due-asc",
	defaultZoom: "month",
	maxNotesPerProject: 5,
};

/** 索引产出的项目条目（逻辑字段，视图与筛选管道只认它） */
export interface ProjectItem {
	/** 规范化状态；解析失败为 null（非法数据，UI 提示修复） */
	status: ProjectStatus | null;
	/** 规范化日期 YYYY-MM-DD；缺失为 null */
	startDate: string | null;
	dueDate: string | null;
	completionDate: string | null;
	progress: number | null;
	priority: string | null;
	area: string[];
	objective: string | null;
	context: string | null;
	longTerm: boolean;
	mainProject: boolean;
	projectId: string | null;
	projectLeader: string | null;
	projectMembers: string[];
	tags: string[];
	/** 所属笔记（点击跳转目标） */
	file: { path: string; name: string; folder: string };
}
