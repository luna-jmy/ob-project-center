/**
 * Project Master — 类型与设置定义（SPEC.md §2/§5 的单一事实源）
 *
 * 参数分离原则（agent.md §2.5）：
 * - 插件内部只使用逻辑字段名（FieldMappingConfig 的键）；
 * - 物理字段名（frontmatter 里的真实名字）只出现在 FieldMappingConfig 的值中；
 * - 所有业务常量必须可由设置覆盖，禁止散落硬编码。
 */

import { LanguageSetting, t } from "./i18n";

/** 设置结构版本（新增/改动字段时递增，迁移函数见 settings-migration.ts） */
export const SETTINGS_VERSION = 7;

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

/**
 * status 英文值 → 展示标签的**原文**（中文即字典键，见 src/i18n/translate.ts）。
 *
 * 这里存原文、取用时经 `t()` 出当前语言。**不能写成模块级常量映射**：那会在 import
 * 时就把当时的语言冻住，用户切语言后界面不跟着变。
 */
const STATUS_LABEL_SOURCE: Readonly<Record<ProjectStatus, string>> = {
	inbox: "未开始/待启动",
	draft: "起草/构思中",
	active: "执行中",
	"on-hold": "暂停",
	completed: "完成",
	cancelled: "取消",
	archived: "归档",
};

/** status 展示标签（模板 suggester 的展示口径，Modal 下拉用） */
export function statusLabel(status: ProjectStatus): string {
	return t(STATUS_LABEL_SOURCE[status]);
}

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

/** priority 英文值 → 展示标签的原文（理由同 STATUS_LABEL_SOURCE） */
const PRIORITY_LABEL_SOURCE: Readonly<Record<string, string>> = {
	"1": "最高",
	"2": "高",
	"3": "中",
	"4": "低",
	"5": "最低",
};

/** priority 展示标签；认不出的值原样返回，不隐藏用户真实写的东西 */
export function priorityLabel(value: string): string {
	const source = PRIORITY_LABEL_SOURCE[value];
	return source === undefined ? value : t(source);
}

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

/**
 * 字段映射在设置页上的说法：**只讲人话，不讲代码**（用户口径 2026-09-20）。
 *
 * 设置页左边标题是「这是什么信息」，右边输入框填「这条信息写在 frontmatter 的哪个字段名里」。
 * 用户不需要知道代码里这个属性叫什么（`completionDate` 这种名字是给代码看的），
 * 只需要知道「项目完成日期该写在哪个字段」——所以这里存放的是含义，不是键名。
 *
 * 类型写成 `Record<keyof FieldMappingConfig, …>` 是刻意的：以后往映射表里加字段却忘了写说明，
 * 会直接编译不过，而不是在设置页上又漏出一行逻辑字段名。
 */
export interface SettingFieldCopy {
	/** 设置页左侧标题（人话含义，不出现代码字段名） */
	label: string;
	/** 这条信息是干什么的、会影响哪里 */
	desc: string;
}

const FIELD_COPY_SOURCE: Record<keyof FieldMappingConfig, SettingFieldCopy> = {
	type: { label: "项目识别字段", desc: "这个字段的值等于 project 时，笔记会被识别为项目。" },
	status: { label: "项目状态字段", desc: "未开始 / 起草中 / 执行中 / 暂停 / 完成 / 取消 / 归档。" },
	priority: {
		label: "优先级字段",
		desc: "1–5 的数字，1 为最高；导出 Mermaid 时 1、2 会标成关键任务。",
	},
	startDate: { label: "项目开始日期", desc: "甘特图的起点。" },
	dueDate: { label: "项目截止日期", desc: "甘特图的终点，也是排序与逾期判断的依据。" },
	endDateFallback: {
		label: "结束日期备用字段",
		desc: "截止日期缺失时用它兜底（模板里的成稿/结束日期）。",
	},
	completionDate: { label: "项目完成日期", desc: "实际完成的那一天。" },
	progress: { label: "完成进度字段", desc: "0–100 的百分比，显示在分组卡片上。" },
	area: { label: "所属领域字段", desc: "可以写多个值；按「领域」分组或筛选时用。" },
	objective: { label: "所属目标字段", desc: "按「目标」分组时用；Mermaid 的分节也按它划分。" },
	context: { label: "场景字段", desc: "模板里的场景/情境信息，目前只读取、界面上未使用。" },
	projectLeader: { label: "项目负责人", desc: "单个值。" },
	projectMembers: { label: "项目成员", desc: "可以写多个值。" },
	longTerm: {
		label: "长期项目标记",
		desc: "true / false；开启后豁免全部日期筛选，并且不上甘特图（只在面板里出现）。",
	},
	mainProject: {
		label: "代表项目标记",
		desc: "true / false；同一文件夹里有多个项目时，标 true 的那条作为代表卡片。",
	},
	projectId: { label: "项目编号", desc: "跨笔记关联用的唯一标识，目前只读取。" },
	color: {
		label: "甘特条颜色",
		desc: "可写 #ff8800、var(--color-orange) 或颜色名；留空按项目状态用默认色。",
	},
	identifyTag: { label: "补充识别标签", desc: "笔记的 tags 里含这个标签时也算项目。" },
};

/** 某个映射字段在设置页上的说法（原文经 `t()` 出当前语言） */
export function fieldCopy(field: keyof FieldMappingConfig): SettingFieldCopy {
	const copy = FIELD_COPY_SOURCE[field];
	return { label: t(copy.label), desc: t(copy.desc) };
}

export type DateFallbackStrategy = "offset7" | "mark-invalid";
/**
 * 分组维度。
 * `none` = 不按文件夹/目标/领域切：除快速项目单独成区外，所有项目合成一份扁平列表，
 * 一个项目一张卡片（用户口径 2026-09-21，见 grouping-service 的 groupByKind）。
 */
export type GroupingMode = "folder" | "objective" | "area" | "none";
/** `manual` = 用户在面板上拖动排出来的顺序（见 services/manual-order.ts） */
export type SortMode =
	| "due-asc"
	| "due-desc"
	| "start-asc"
	| "start-desc"
	| "name"
	| "priority"
	| "manual";
/** 时间粒度：日 → 周 → 月 → 年（年档按季度画线，用来一屏看全年） */
export type ZoomMode = "day" | "week" | "month" | "year";

/**
 * bar 上显示的天数口径（用户要求 2026-09-20）。
 * - `off`：不显示；
 * - `calendar`：自然日跨度（含首尾）；
 * - `workday`：工作日跨度 = 自然日 − 非工作日（周末 / 法定节假日，补班日算工作日）。
 *   「哪些日子不算工作日」完全取自「排除周末」开关与法定节假日排期，
 *   与导出 mermaid 的 excludes/includes 是同一份口径。
 */
export type BarDurationMode = "off" | "calendar" | "workday";

/*
 * 下面三份「全量清单」供设置迁移（白名单校验）与 UI（下拉选项）共用。
 *
 * 用 `Record<T, true>` 派生而不是手写数组字面量：**漏写一个成员会直接编译报错**。
 * 数组字面量只会静静地和类型定义脱节——迁移层的缩放白名单就这么漏掉过 `year`，
 * 结果用户选了「年」档，一保存就被重置回「月」档，而且完全不报错。
 */
const GROUPING_MODE_KEYS: Record<GroupingMode, true> = {
	folder: true,
	objective: true,
	area: true,
	none: true,
};
export const GROUPING_MODES = Object.keys(GROUPING_MODE_KEYS) as GroupingMode[];

/** `manual` 不在设置页下拉里出现（靠拖动自动切换），但它确实是合法取值 */
const SORT_MODE_KEYS: Record<SortMode, true> = {
	"due-asc": true,
	"due-desc": true,
	"start-asc": true,
	"start-desc": true,
	name: true,
	priority: true,
	manual: true,
};
export const SORT_MODES = Object.keys(SORT_MODE_KEYS) as SortMode[];

const ZOOM_MODE_KEYS: Record<ZoomMode, true> = {
	day: true,
	week: true,
	month: true,
	year: true,
};
export const ZOOM_MODES = Object.keys(ZOOM_MODE_KEYS) as ZoomMode[];

const BAR_DURATION_MODE_KEYS: Record<BarDurationMode, true> = {
	off: true,
	calendar: true,
	workday: true,
};
export const BAR_DURATION_MODES = Object.keys(BAR_DURATION_MODE_KEYS) as BarDurationMode[];

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

/**
 * 某一年度的法定节假日排期。
 *
 * 两个字段都是**自由文本清单**而不是日期数组：用户改的是「10-01~10-07」这种写法，
 * 存成数组反而要在 UI 与存储之间来回翻译。展开成具体日期由
 * `services/holiday-schedule.ts` 负责（纯函数，可测）。
 */
export interface YearHolidaySchedule {
	/** 放假：`MM-DD`、`MM-DD~MM-DD`（跨年自动算到次年）或完整 `YYYY-MM-DD`，逗号/空格分隔 */
	holidays: string;
	/** 调休上班日：写法同上，导出为 includes（优先级高于放假） */
	makeupWorkdays: string;
}

/** 年度排期表：键 = 四位年份 */
export type HolidayScheduleMap = Record<string, YearHolidaySchedule>;

/**
 * 甘特条配色（用户口径 2026-09-20）。
 *
 * 只给「会改变 Mermaid 外观」的那几类预设颜色，其余一律走 `fallback`：
 * Mermaid 的甘特图只有三种标记会改变任务的样子——`active`（进行中）、`done`（已完成）、
 * `crit`（关键任务 = priority 1/2）。早先这里是按 7 个 status 各配一种主题色
 * （青/橙/蓝/紫…），颜色多到没有信息量，反而看不出重点。
 *
 * 取值为任意 CSS 颜色：`var(--color-blue)` 会随明暗主题走，也可以写 `#3b82f6`。
 */
export interface GanttBarColors {
	/** 进行中（Mermaid 的 active）——填充色 */
	active: string;
	/** 已完成（Mermaid 的 done）——填充色 */
	completed: string;
	/** 关键任务（Mermaid 的 crit，即 priority 1/2）——**描边色**，不是填充色 */
	critical: string;
	/** 其余状态（未开始 / 起草中 / 暂停 / 取消 / 归档…）——填充色 */
	fallback: string;
}

export const DEFAULT_GANTT_BAR_COLORS: GanttBarColors = {
	active: "var(--color-blue)",
	completed: "var(--color-green)",
	critical: "var(--color-red)",
	fallback: "var(--text-muted)",
};

/** 设置页上这四类颜色的说法（原文；理由同 FIELD_COPY_SOURCE） */
const BAR_COLOR_COPY_SOURCE: Record<keyof GanttBarColors, SettingFieldCopy> = {
	active: { label: "进行中", desc: "状态为「执行中」的条子；对应 Mermaid 的 active。" },
	completed: { label: "已完成", desc: "状态为「完成」的条子；对应 Mermaid 的 done。" },
	critical: {
		label: "重要（关键任务）",
		desc: "优先级为 1（最高）或 2（高）的条子；对应 Mermaid 的 crit，画成外圈描边。",
	},
	fallback: {
		label: "其他状态",
		desc: "未开始 / 起草中 / 暂停 / 取消 / 归档等状态共用这一色。",
	},
};

/** 某类甘特条颜色在设置页上的说法（原文经 `t()` 出当前语言） */
export function barColorCopy(key: keyof GanttBarColors): SettingFieldCopy {
	const copy = BAR_COLOR_COPY_SOURCE[key];
	return { label: t(copy.label), desc: t(copy.desc) };
}

/**
 * 面板卡片文字的缩放区间（百分比）。
 * 设置页的输入框与迁移清洗共用这一份，避免两处各写一个上下限然后慢慢对不上。
 */
export const CARD_FONT_SCALE_RANGE = { min: 60, max: 220 } as const;

export interface ProjectMasterSettings {
	version: number;
	/** 项目扫描目录（多目录，SPEC §5.1） */
	scanFolders: string[];
	/**
	 * 路径含此标记的文件夹归入「快速项目」分区。
	 *
	 * **留空是合法值**（用户口径 2026-09-20）：空 = 只把扫描目录根层的项目当快速项目，
	 * 新建的快速项目也直接放在扫描目录下（见 project-service 的 quickProjectFolder）。
	 *
	 * 留空不会误伤别处：两处判定都用「路径段 === 标记」，而 `split("/")` 的段永远不是空串，
	 * 所以空标记只会命中「根层」那一条分支，不会匹配到任意文件夹。
	 */
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
	/** 甘特条上显示的天数口径（不显示 / 自然日 / 工作日） */
	ganttBarDuration: BarDurationMode;
	/**
	 * 甘特条配色：只给「Mermaid 里颜色会变」的几类（进行中 / 已完成 / 关键任务）+ 其他兜底。
	 * 「关键任务」= priority 1/2，与导出 Mermaid 的 `crit` 同源（见 gantt/bar-colors）。
	 */
	ganttBarColors: GanttBarColors;
	/**
	 * 面板卡片内文字的缩放百分比（100 = 跟随主题默认，用户口径 2026-09-20）。
	 *
	 * 为什么是百分比而不是 px：卡片里的字有三级（标题 / 正文 / 注释），各自取主题的
	 * 不同字号变量。统一给一个 px 会把层级压成一样大；倍率则整体缩放、比例不变
	 * （样式表侧写成 `calc(倍率 * 主题字号)`，见 styles.css 面板区开头的说明）。
	 */
	cardFontScale: number;
	/**
	 * 界面语言（用户口径 2026-09-21：加字典、支持英文版）。
	 *
	 * `auto` = 跟随 Obsidian 的界面语言；也可以强制 `zh` / `en`。
	 * 只影响**界面文案**，不影响数据默认值（扫描目录、快速项目标记、资料子文件夹名
	 * 这些是用户 vault 里的既有约定，不随语言变——否则切一下语言就找不到自己的文件了）。
	 */
	uiLanguage: LanguageSetting;
	/**
	 * 「资料/笔记」子文件夹名（新建「带文件夹」形态的项目时预建）。
	 *
	 * **留空是合法值**（用户口径 2026-09-20）：不预建子文件夹，资料与项目文档放在
	 * 同一个文件夹里。资料归集本来就同时收「同层笔记」与「子文件夹里的笔记」，
	 * 与这个参数无关——所以留空不会让资料算不出来，只是少建一个目录。
	 */
	materialsFolderName: string;
	/**
	 * 新建项目时套用的模板笔记（vault 相对路径；留空 = 不用模板）。
	 *
	 * 口径（用户口径 2026-09-20）：
	 * - **留空**：与既有行为完全一致——只写一行标题，字段全部由弹窗值 + 字段映射生成；
	 * - **非空**：正文整篇用模板的，**只补模板里缺的** frontmatter 字段（模板已给的值，
	 *   包括日期/状态占位符，一律不动）。
	 *
	 * 模板里的 Templater 命令（`<% … %>`）会交给 Templater 执行，所以用户模板里常见的
	 * `tp.file.title`、`tp.system.suggester` 都按原样工作；没装 Templater 时命令原样保留。
	 */
	newProjectTemplate: string;
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
	/** Mermaid 导出：额外排除的日期，逗号分隔（法定节假日用），输出 excludes 列表 */
	mermaidExcludeDates: string;
	/**
	 * Mermaid 导出：**强制算作工作日**的日期，逗号分隔（调休补班用），输出 includes 列表。
	 *
	 * mermaid 的 `includes` 是优先级最高的「工作日白名单」：命中它的日子一律不算被排除，
	 * 因此能把「周六但上班」的调休日从 excludes（含 excludes weekends）的灰列里捞回来。
	 * 官方文档没写这个指令，但语法与渲染器都支持（2026-09-20 核实）。
	 */
	mermaidIncludeDates: string;
	/**
	 * 年度法定节假日排期（键 = 四位年份）。
	 *
	 * 导出时按**甘特图跨到的年份**自动套用，所以不必在视图里手打每天的日期；
	 * 面板上的两个输入框退化成「临时补充」。
	 */
	holidaySchedules: HolidayScheduleMap;
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
	ganttBarDuration: "off",
	// 复制而非共享引用：DEFAULT_SETTINGS 会被多处读取，共享可变对象是隐患
	ganttBarColors: { ...DEFAULT_GANTT_BAR_COLORS },
	// 100 = 跟随主题默认字号，即「没设置过」时的表现
	cardFontScale: 100,
	// auto = 跟随 Obsidian 界面语言（中文用户看到中文，英文用户看到英文）
	uiLanguage: "auto",
	materialsFolderName: "资料",
	// 空串 = 不用模板，行为与「没有这个参数」时一致
	newProjectTemplate: "",
	manualGroupOrder: {},
	manualProjectOrder: {},
	mermaidTitle: "项目进度甘特图",
	mermaidTodayMarker: true,
	mermaidExcludeWeekends: false,
	mermaidExcludeDates: "",
	mermaidIncludeDates: "",
	holidaySchedules: {},
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
