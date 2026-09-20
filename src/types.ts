/**
 * Project Master — 类型与设置定义（SPEC.md §2/§5 的单一事实源）
 *
 * 参数分离原则（agent.md §2.5）：
 * - 插件内部只使用逻辑字段名（FieldMappingConfig 的键）；
 * - 物理字段名（frontmatter 里的真实名字）只出现在 FieldMappingConfig 的值中；
 * - 所有业务常量必须可由设置覆盖，禁止散落硬编码。
 */

/** 设置结构版本（新增/改动字段时递增，迁移函数见 settings-migration.ts） */
export const SETTINGS_VERSION = 4;

/** 规范化项目状态（canonical，机器值全小写英文） */
export type ProjectStatus =
	| "inbox"
	| "draft"
	| "active"
	| "on-hold"
	| "completed"
	| "cancelled"
	| "archived";

/** 全部合法状态（默认顺序即 suggester 顺序，对齐 TPL-Project 模板交互） */
export const PROJECT_STATUSES: ProjectStatus[] = [
	"inbox",
	"draft",
	"active",
	"on-hold",
	"completed",
	"cancelled",
	"archived",
];

/** status 英文值 → 中文标签（模板 suggester 的展示口径，Modal 下拉用） */
export const STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
	inbox: "未开始/待启动",
	draft: "起草/构思中",
	active: "执行中",
	"on-hold": "暂停",
	completed: "完成",
	cancelled: "取消",
	archived: "归档",
};

/** status 徽章 emoji（继承 ref/projectOverview.js statusMap） */
export const STATUS_EMOJI: Readonly<Record<ProjectStatus, string>> = {
	inbox: "📥",
	draft: "✏️",
	active: "🚀",
	"on-hold": "⏸️",
	completed: "✅",
	cancelled: "❌",
	archived: "📦",
};

/** priority 值 → emoji（继承 ref/projectOverview.js priorityMap） */
export const PRIORITY_EMOJI: Readonly<Record<string, string>> = {
	"1": "🔴",
	"2": "🟠",
	"3": "🟡",
	"4": "🔵",
	"5": "⚪",
};

/** priority 英文值 → 模板中文标签 */
export const PRIORITY_LABELS: Readonly<Record<string, string>> = {
	"1": "最高",
	"2": "高",
	"3": "中",
	"4": "低",
	"5": "最低",
};

/** status 中文别名 → 规范值（SPEC §2.3，仅在 chineseAliasCompat 开启时生效；可被设置覆盖） */
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
	/** 甘特条自定义颜色（可写 #hex / var(--x) / 颜色名） */
	color: string;
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
	color: "color",
	identifyTag: "project",
};

export type DateFallbackStrategy = "offset7" | "mark-invalid";
export type GroupingMode = "folder" | "objective" | "area";
/** `manual` = 用户在面板上拖动排出来的顺序（见 services/manual-order.ts） */
export type SortMode = "due-asc" | "name" | "priority" | "manual";
export type ZoomMode = "day" | "week" | "month";

/**
 * 打开 dashboard 时「项目开始年度」筛选的默认档。
 * - `current`：默认只显示本年度启动的项目（用户要求 2026-09-18，避免项目太多）；
 * - `none`：默认不限年度（想一进来就看到全部时用）。
 */
export type DefaultYearFilter = "current" | "none";

/**
 * 甘特分节描述（由分组服务产出，左右面板共用同一份）。
 * 放在 types 里是因为它跨 services 与 gantt 两层：
 * 分组服务负责产出内容与顺序，甘特模型负责按它排布，避免任一方反向依赖另一方。
 */
export interface GroupSectionSpec {
	/** 联动 key：folder 模式是文件夹路径，值模式是 objective/area 值 */
	key: string;
	/** 展示标题 */
	name: string;
	/** 该分节包含的项目文档路径 */
	paths: string[];
	/** 是否折叠（视图状态，由调用方补上） */
	collapsed: boolean;
}

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
	/** 缺失日期的兜底策略：±N 天 or 标记无效 */
	dateFallback: DateFallbackStrategy;
	/** 兜底天数（SPEC §2.3 的 ±7 天，参数化避免硬编码） */
	dateFallbackDays: number;
	fieldMapping: FieldMappingConfig;
	/** status 中文别名映射表（可编辑，SPEC §5.3） */
	statusAliases: Record<string, ProjectStatus>;
	/** status 徽章 emoji（可编辑，SPEC §5.3） */
	statusEmoji: Record<string, string>;
	/** status suggester 顺序（可编辑，SPEC §5.3） */
	statusOrder: ProjectStatus[];
	/** priority 徽章 emoji（可编辑，SPEC §5.3） */
	priorityEmoji: Record<string, string>;
	defaultGrouping: GroupingMode;
	defaultSort: SortMode;
	defaultZoom: ZoomMode;
	/** 打开视图时开始年度筛选的默认档 */
	defaultYearFilter: DefaultYearFilter;
	/** 每项目笔记预览条数（现有 maxNotes 行为；0 = 不限） */
	maxNotesPerProject: number;
	/** 甘特图是否默认隐藏 cancelled 项目（SPEC F1.6 现有规则） */
	hideCancelledInGantt: boolean;
	/** 「资料/笔记」子文件夹名（新建带文件夹的项目时可一并创建） */
	materialsFolderName: string;
	/**
	 * 手动排序：分组顺序，按分组模式分别记录（键 = "folder" / "objective" / "area"）。
	 * 只有排序档为「手动」时才生效；拖动分组后自动切到该档。
	 */
	manualGroupOrder: Record<string, string[]>;
	/** 手动排序：分组内项目顺序（键 = `${分组模式}::${分组 key}`） */
	manualProjectOrder: Record<string, string[]>;
	/** Mermaid 导出标题（SPEC F1.7，对齐 projectGantt.js） */
	mermaidTitle: string;
	/** Mermaid 导出：是否显示「今天」的竖线（关掉时输出 todayMarker off） */
	mermaidTodayMarker: boolean;
	/** Mermaid 导出：是否排除周末（excludes weekends） */
	mermaidExcludeWeekends: boolean;
	/** Mermaid 导出：额外排除的日期，逗号分隔（国内假期用），输出 excludes 列表 */
	mermaidExcludeDates: string;
	/** 无 objective 项目的 Mermaid 分节名（对齐 projectGantt.js「默认项目」） */
	mermaidSectionFallback: string;
	/** 「导出到笔记」的落点标记（复用 gantt-builder 占位块，SPEC F1.7） */
	mermaidMarkerStart: string;
	mermaidMarkerEnd: string;
}

export const DEFAULT_SETTINGS: ProjectMasterSettings = {
	version: SETTINGS_VERSION,
	scanFolders: ["100 Projects"],
	quickProjectMarker: "快速项目",
	excludedFolders: ["templates"],
	chineseAliasCompat: true,
	dateFallback: "offset7",
	dateFallbackDays: 7,
	// 复制而非共享引用：DEFAULT_SETTINGS 会被多处读取，共享可变对象是隐患
	fieldMapping: { ...DEFAULT_FIELD_MAPPING },
	statusAliases: { ...STATUS_CHINESE_ALIASES },
	statusEmoji: { ...STATUS_EMOJI },
	statusOrder: [...PROJECT_STATUSES],
	priorityEmoji: { ...PRIORITY_EMOJI },
	defaultGrouping: "folder",
	defaultSort: "due-asc",
	defaultZoom: "month",
	defaultYearFilter: "current",
	maxNotesPerProject: 5,
	hideCancelledInGantt: true,
	materialsFolderName: "资料",
	manualGroupOrder: {},
	manualProjectOrder: {},
	mermaidTitle: "项目进度甘特图",
	mermaidTodayMarker: true,
	mermaidExcludeWeekends: false,
	mermaidExcludeDates: "",
	mermaidSectionFallback: "默认项目",
	mermaidMarkerStart: "%% gantt-builder:start %%",
	mermaidMarkerEnd: "%% gantt-builder:end %%",
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
	/** 甘特条自定义颜色；未设置或格式非法时为 null（非法时另出 issue 提示） */
	color: string | null;
	projectLeader: string | null;
	projectMembers: string[];
	tags: string[];
	/** 所属笔记（点击跳转目标） */
	file: { path: string; name: string; folder: string };
}
