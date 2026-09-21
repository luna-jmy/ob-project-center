import { App, getIconIds, ItemView, normalizePath, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { buildGanttModel, ganttSkipMessage, GanttModel } from "../gantt/gantt-model";
import { t } from "../i18n";
import { exportableRows, exportMermaid, wrapInMarkers } from "../gantt/mermaid-export";
import { GanttView, ZoomAnchor } from "../gantt/gantt-view";
import { MermaidTargetModal } from "../modals/mermaid-target-modal";
import { NewProjectModal } from "../modals/new-project-modal";
import { ProjectEditorModal } from "../modals/project-editor-modal";
import { FilterBar } from "../panels/filter-bar";
import { GroupPanel } from "../panels/group-panel";
import { MermaidOptions, MermaidPanel } from "../panels/mermaid-panel";
import { clampSplitWidth, SplitResizer } from "../panels/split-resizer";
import {
	exportImageName,
	MermaidImageExport,
	readAttachmentSetting,
	resolveAttachmentFolder,
} from "../panels/svg-image";
import { collectSuggestions } from "../services/frontmatter-mapping";
import { normalizeSingleValue } from "../services/normalize";
import { DataIssue } from "../services/project-item";
import { ProjectService } from "../services/project-service";
import {
	applyFilters,
	collectYears,
	defaultFilterState,
	describeYearState,
	detectStatusPreset,
	explainHidden,
	initialFilterState,
	FilterState,
	longTermFirst,
	presetToStatuses,
	resolveDateRange,
	shouldPinLongTerm,
	sortProjects,
	statusPresetLabel,
} from "../services/filter-service";
import {
	groupProjects,
	GroupingResult,
	NoteLink,
	toSectionSpecs,
} from "../services/grouping-service";
import {
	applyManualOrderIfNeeded,
	mergeVisibleOrder,
	projectOrderKey,
} from "../services/manual-order";
import {
	GroupingMode,
	ProjectItem,
	ProjectMasterSettings,
	SIDEBAR_WIDTH_RANGE,
	SortMode,
	ZoomMode,
} from "../types";
import { todayIso } from "../utils/date";
import { pickViewIcon } from "../utils/icon";

/** 视图类型 ID：pm- 前缀保证不与其他插件的 view type 冲突（agent.md §2.1） */
export const VIEW_TYPE_PM_DASHBOARD = "pm-dashboard-view";

/** 时间粒度阶梯：由粗到细，Ctrl +/- 在这条线上走 */
const ZOOM_LADDER: readonly ZoomMode[] = ["year", "month", "week", "day"];
/** 粒度显示名（函数求值：常量映射会在 import 时把语言冻住） */
function zoomLabel(mode: ZoomMode): string {
	switch (mode) {
		case "year":
			// 这一档画的是**季度**线（见 gantt/time-scale.ts），标签就照实叫季度
			return t("季度");
		case "month":
			return t("月");
		case "week":
			return t("周");
		default:
			return t("日");
	}
}

/** 主区两块（Tab 栏在主区内部，两者同级） */
type TabId = "gantt" | "mermaid";

/** 只对甘特视图有意义的工具栏控件：面板模式下隐藏（用户口径 2026-09-20） */
const GANTT_ONLY_CLASS = "pm-toolbar__gantt-only";

/**
 * 侧栏最多占的分栏比例（用户口径 2026-09-21）。
 *
 * 与 styles.css 里 `.pm-side` 的 `max-width` 是同一口径：那份管首屏（还没拖过时的
 * 上限），这份管交互（拖动时能拖多宽）。两处都写是因为一个在 CSS、一个在拖动逻辑里，
 * 没法共用同一个常量——改的时候要一起改。
 */
const SIDEBAR_MAX_RATIO = 0.6;
/** Tab 标题（函数求值，理由同 zoomLabel） */
function tabLabel(id: TabId): string {
	return id === "gantt" ? t("甘特图") : t("Mermaid 预览");
}
const TAB_IDS: readonly TabId[] = ["gantt", "mermaid"];



/**
 * 视图对插件的依赖（接口注入而非直接引用插件类）。
 * 这样 views → main 不产生循环 import，视图也能只看到它需要的东西。
 */
export interface DashboardHost {
	readonly app: App;
	readonly settings: ProjectMasterSettings;
	readonly service: ProjectService;
	/** 全量索引（未过滤） */
	getProjects(): ProjectItem[];
	/** 数据问题：path → issues（SPEC §2.3 UI 修复提示） */
	getIssues(): Record<string, DataIssue[]>;
	/** 文件夹 → 全部笔记（分组面板的组内笔记列表用，F3.3） */
	getFolderNotes(): Record<string, NoteLink[]>;
	/** 请求刷新所有已打开的 dashboard 视图 */
	requestRefresh(): void;
	/** 只落盘设置（手动排序/导出选项这类不影响索引的改动走它，避免白重建索引） */
	persistSettings(): Promise<void>;
}

/**
 * Dashboard 主视图（SPEC §3/F5）—— 布局组装与生命周期。
 *
 * 单向数据流（§3.1）：
 *   frontmatter → 索引/规范化 → filter/grouping 管道 → 渲染
 *   UI 编辑 → processFrontMatter → 事件驱动 → 索引 → 再渲染
 *
 * 主区两块（用户口径 2026-09-20 修订）：Tab 栏放在**主区内部**，
 *   「甘特图」= 自绘交互式视图（唯一可编辑版本）；「Mermaid 预览」= 导出内容核对区。
 * 两者同级、吃同一次 refresh 的模型；Tab 栏右侧常驻同步状态，
 * 所以「预览是不是过期了」不靠猜——即使不切过去也看得见。
 */
export class DashboardView extends ItemView {
	/**
	 * 默认带「隐藏已完成 + 开始年度 = 当前年度」（年度档由设置决定），见 initialFilterState()。
	 * 刻意放在构造函数里赋值而不是字段初始化：`host` 是构造参数属性，
	 * 字段初始化器与参数属性赋值的先后顺序在 downlevel 产物里不直观，写在构造函数体里没有歧义。
	 */
	private filterState: FilterState;
	private groupingMode: GroupingMode;
	private sortMode: SortMode;
	private zoom: ZoomMode;
	/**
	 * 主区当前显示哪一块。
	 *
	 * Tab 栏在**主区内部**（甘特图 / Mermaid 预览），所以两者是同级的两块，
	 * 共享上面的筛选栏与左侧面板——而不是一层包住整页、把筛选栏也卷进去的 Tab。
	 * 上下堆叠的版本两边都被挤扁（预览里的 mermaid 标签直接叠在一起），
	 * 所以改用切换：谁在前台谁就拿满高度。
	 */
	private activeTab: TabId = "gantt";
	private sideCollapsed = false;
	/** 侧栏元素：拖动分隔条时要往里写宽度变量（用户口径 2026-09-21） */
	private sideEl: HTMLElement | null = null;
	/** 面板模式（面板内容铺满整页的卡片视图）。与「收起侧栏」是两件事，互不替代 */
	private panelMode = false;
	/** 进面板模式前甘特时间轴的滚动位置（祖先 display:none 会把它清零，退出时还原） */
	private ganttScroll: { left: number; top: number } | null = null;
	/**
	 * 折叠的分组 key（folder 模式是文件夹路径，值模式是 objective/area 值）。
	 * 一份状态同时喂给左面板卡片与甘特分节——两处折叠永远一致。
	 */
	private readonly collapsedKeys = new Set<string>();
	/** 最近一次由甘特模型生成的 mermaid 全文（预览与导出的唯一来源） */
	private lastGenerated = "";
	/** 缩放锚点：本轮 refresh 后要让甘特把该日期固定回原位 */
	private pendingAnchor: ZoomAnchor | null = null;

	private filterBar: FilterBar | null = null;
	private groupPanel: GroupPanel | null = null;
	private gantt: GanttView | null = null;
	private mermaidPanel: MermaidPanel | null = null;

	private rootEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private ganttHostEl: HTMLElement | null = null;
	private mermaidHostEl: HTMLElement | null = null;
	private mermaidStatusEl: HTMLElement | null = null;
	private tabButtons: Partial<Record<TabId, HTMLButtonElement>> = {};
	private issuesEl: HTMLElement | null = null;
	private statsEl: HTMLElement | null = null;
	private groupingSelect: HTMLSelectElement | null = null;
	private zoomSelect: HTMLSelectElement | null = null;

	private lastModel: GanttModel | null = null;
	private lastGroups: GroupingResult | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: DashboardHost,
	) {
		super(leaf);
		const settings = host.settings;
		this.groupingMode = settings.defaultGrouping;
		this.sortMode = settings.defaultSort;
		this.zoom = settings.defaultZoom;
		this.filterState = initialFilterState(todayIso(), settings.defaultYearFilter);
	}

	getViewType(): string {
		return VIEW_TYPE_PM_DASHBOARD;
	}

	getDisplayText(): string {
		return "Project dashboard";
	}

	getIcon(): string {
		// 与侧栏 ribbon 共用同一个来源，免得两处各写一份图标名、改一处漏一处
		return pickViewIcon(getIconIds());
	}

	// ────────────────────────────── 生命周期 ──────────────────────────────

	async onOpen(): Promise<void> {
		// 根容器：pm- 前缀，全部样式限制在此作用域内（agent.md §2.1/§2.2）
		const root = this.contentEl.createDiv({ cls: "pm-dashboard-root" });
		this.rootEl = root;
		this.buildToolbar(root);
		this.buildFilterBar(root);
		this.issuesEl = root.createDiv({ cls: "pm-issues" });
		this.buildBody(root);
		this.statsEl = root.createDiv({ cls: "pm-stats" });

		// Ctrl/Cmd +/- 调时间粒度（用户要求）；滚轮仍留给滚动，避免冲突。
		// 注册在 contentEl 上：只要视图内有焦点就能收到，且不占用全局快捷键。
		this.registerDomEvent(this.contentEl, "keydown", (evt) => this.onKeyDown(evt));

		this.refresh();
	}

	async onClose(): Promise<void> {
		// 视图自有资源在此收口；不 detach leaves，不跨视图清理
		this.gantt?.destroy();
		this.mermaidPanel?.destroy();
		this.gantt = null;
		this.mermaidPanel = null;
		this.filterBar = null;
		this.groupPanel = null;
		this.contentEl.empty();
	}

	// ────────────────────────────── 布局 ──────────────────────────────

	private buildToolbar(root: HTMLElement): void {
		const bar = root.createDiv({ cls: "pm-toolbar" });
		bar.createEl("h2", { cls: "pm-toolbar__title", text: t("项目中心") });

		const actions = bar.createDiv({ cls: "pm-toolbar__actions" });

		this.addButton(actions, t("新建项目"), () => this.openNewProjectModal());
		this.addButton(actions, t("刷新"), () => this.refresh());

		const grouping = actions.createEl("select", {
			cls: "dropdown pm-toolbar__select",
			attr: { "aria-label": t("分组依据") },
		});
		for (const [value, label] of [
			["folder", t("按文件夹分组")],
			["objective", t("按目标分组")],
			["area", t("按领域分组")],
			// 标签里点明它会分成哪几块：叫「不分组」却出现三块，不说明一句会让人以为坏了
			["none", t("不分组（按资料情况）")],
		] as [GroupingMode, string][]) {
			grouping.createEl("option", { value, text: label });
		}
		grouping.value = this.groupingMode;
		this.groupingSelect = grouping;
		this.registerDomEvent(grouping, "change", () => {
			this.groupingMode = grouping.value as GroupingMode;
			// 折叠状态是按 key 记的：folder 模式记的是文件夹路径，换到 objective 模式就对不上了，
			// 留着只会变成一组「永远无法展开」的残留状态，直接清空更干净
			this.collapsedKeys.clear();
			this.refresh();
		});

		// 时间粒度：既是当前档位的指示器，也是最直观的「恢复」入口
		const zoom = actions.createEl("select", {
			cls: `dropdown pm-toolbar__select ${GANTT_ONLY_CLASS}`,
			// 快捷键说明放在底部统计行里（那里能一并说明 Ctrl+0 恢复），这里只留无障碍标签
			attr: { "aria-label": t("时间粒度") },
		});
		for (const mode of ZOOM_LADDER) {
			zoom.createEl("option", {
				value: mode,
				text: t("{unit}刻度", { unit: zoomLabel(mode) }),
			});
		}
		zoom.value = this.zoom;
		this.zoomSelect = zoom;
		this.registerDomEvent(zoom, "change", () => {
			this.zoom = zoom.value as ZoomMode;
			this.refresh();
		});

		// 以下四个只对甘特视图有意义：面板模式下由 CSS 隐藏（用户口径 2026-09-20）
		this.addButton(actions, t("恢复缩放"), () => this.resetZoom(), GANTT_ONLY_CLASS);
		this.addButton(actions, t("全部展开"), () => this.setAllCollapsed(false), GANTT_ONLY_CLASS);
		this.addButton(actions, t("全部收起"), () => this.setAllCollapsed(true), GANTT_ONLY_CLASS);
		// 侧栏显隐：名字刻意与「面板模式」区分开——那个是整页卡片视图，不是收放侧栏
		this.addButton(
			actions,
			this.sideCollapsed ? t("展开侧栏") : t("收起侧栏"),
			(button) => {
				this.sideCollapsed = !this.sideCollapsed;
				this.bodyEl?.toggleClass("pm-body--collapsed", this.sideCollapsed);
				button.setText(this.sideCollapsed ? t("展开侧栏") : t("收起侧栏"));
			},
			GANTT_ONLY_CLASS,
		);
		// 「面板模式」是工具栏里最关键的视图切换：独立样式 + 激活态，与普通按钮区分开
		this.addButton(
			actions,
			this.panelMode ? t("退出面板模式") : t("面板模式"),
			(button) => {
				this.setPanelMode(!this.panelMode);
				button.setText(this.panelMode ? t("退出面板模式") : t("面板模式"));
				button.toggleClass("is-on", this.panelMode);
			},
			"pm-btn--panel-toggle",
		);
	}

	private addButton(
		host: HTMLElement,
		label: string,
		onClick: (button: HTMLButtonElement) => void,
		cls = "",
	): void {
		const button = host.createEl("button", {
			cls: cls.length > 0 ? `pm-btn ${cls}` : "pm-btn",
			text: label,
			attr: { type: "button" },
		});
		this.registerDomEvent(button, "click", () => onClick(button));
	}

	/**
	 * 切换主区显示的那一块。
	 *
	 * 顺序要紧：**先让容器可见，再渲染 mermaid**——mermaid 在 `display:none` 的容器里
	 * 量不到尺寸，渲染出来是坏的（这正是之前上下堆叠时预览里标签叠成一团的原因之一）。
	 */
	private applyTab(): void {
		for (const id of TAB_IDS) {
			const button = this.tabButtons[id];
			button?.toggleClass("is-active", id === this.activeTab);
			button?.setAttribute("aria-selected", String(id === this.activeTab));
		}
		this.ganttHostEl?.toggleClass("is-hidden", this.activeTab !== "gantt");
		this.mermaidHostEl?.toggleClass("is-hidden", this.activeTab !== "mermaid");
		if (this.activeTab === "mermaid") this.mermaidPanel?.update();
	}

	/** Tab 栏右侧的常驻状态：不切过去也能知道预览描述的是哪一份数据 */
	private updateMermaidStatus(): void {
		const status = this.mermaidStatusEl;
		if (status === null) return;
		const rows = this.lastModel?.rows.length ?? 0;
		const visible = exportableRows(this.lastModel).length;
		const hidden = rows - visible;
		status.setText(
			hidden > 0
				? `预览由甘特图实时生成 · ${visible} 个项目（已按折叠隐藏 ${hidden} 个）`
				: `预览由甘特图实时生成 · ${visible} 个项目`,
		);
	}

	private buildFilterBar(root: HTMLElement): void {
		const hostEl = root.createDiv({ cls: "pm-filter-host" });
		this.filterBar = new FilterBar(this, hostEl, {
			getState: () => this.filterState,
			getSortMode: () => this.sortMode,
			getSettings: () => this.host.settings,
			getAvailableAreas: () => this.collectAreas(),
			getAvailableYears: () => this.availableYears(),
			getCurrentAreas: () => this.currentNoteAreas(),
			getCounts: () => this.counts(),
			setStatuses: (statuses) => this.patchState({ statuses }),
			setAreas: (areas) => this.patchState({ areas }),
			setAreaMode: (areaMode) => this.patchState({ areaMode }),
			setSearch: (search) => this.patchState({ search }),
			setDateRange: (dateRange) => {
				this.patchState({ dateRange });
				// 时间区间变了就把粒度恢复成默认档：区间（筛选栏）是「看哪一段」，
				// 粒度（Ctrl+/-）是「看多细」，两者一起用才不会出现「筛了本月却停在月刻度」。
				this.resetZoom();
			},
			setStartYear: (startYear) => this.patchState({ startYear }),
			setEndYear: (endYear) => this.patchState({ endYear }),
			setSortMode: (mode) => {
				this.sortMode = mode;
				this.refresh();
			},
			// 「清除筛选」= 回到**中立基线**（什么都不筛，看全部），
			// 而不是又回到「隐藏已完成 + 本年」的默认档——那正是用户想摆脱的东西
			clearFilters: () => {
				this.filterState = defaultFilterState();
				this.refresh();
			},
		});
	}

	private buildBody(root: HTMLElement): void {
		const body = root.createDiv({ cls: "pm-body" });
		this.bodyEl = body;

		const side = body.createDiv({ cls: "pm-side" });
		this.sideEl = side;
		/*
		 * 侧栏宽度可拖（用户口径 2026-09-21）：分隔条夹在侧栏与主区之间。
		 *
		 * 宽度写进 body 上的 CSS 变量，而不是侧栏的内联样式：面板模式下侧栏要吃满整页
		 * （`.pm-panel-mode .pm-side { flex: 1 1 auto }`），内联样式会把它按死、让位失败。
		 */
		const resizer = body.createDiv({
			cls: "pm-side-resizer",
			attr: {
				role: "separator",
				"aria-orientation": "vertical",
				"aria-label": t("拖动调整侧栏宽度"),
				tabindex: "0",
				title: t("拖动调整侧栏宽度（方向键也能调）"),
			},
		});
		new SplitResizer(this, {
			container: body,
			target: side,
			handle: resizer,
			min: SIDEBAR_WIDTH_RANGE.min,
			// 动态上限：再宽也要给主区留出 40%（窗口变窄时旧宽度会挤掉主区）
			max: () => Math.min(SIDEBAR_WIDTH_RANGE.max, body.clientWidth * SIDEBAR_MAX_RATIO),
			onResize: (width) => body.style.setProperty("--pm-side-width", `${width}px`),
			onCommit: (width) => void this.persistSidebarWidth(width),
		});
		this.applySidebarWidth();
		this.groupPanel = new GroupPanel(this, side, {
			onOpenNote: (path) => this.openNote(path),
			onFocusProject: (path) => this.focusProjectInGantt(path),
			onToggleCollapse: (key) => this.toggleSection(key),
			onHoverProject: (path) => this.hoverProject(path),
			// 面板自带的编辑入口：长期项目不在甘特上，只能从这里改
			onEditProject: (path) => this.openEditorModal(path),
			// 面板模式下拖动卡片（不分组时）/ 拖动分组（分组时）：
			// 与甘特侧栏的拖动共用同一套手动排序落盘
			onReorderProjects: (groupKey, paths) => void this.reorderProjects(groupKey, paths),
			onReorderGroups: (keys) => void this.reorderGroups(keys),
		});

		const main = body.createDiv({ cls: "pm-main" });

		// Tab 栏在主区内部：甘特图与 Mermaid 预览是同级的兄弟块，
		// 共享上面的筛选栏与左侧面板（不再是一层包住整页的 Tab）
		const tabbar = main.createDiv({ cls: "pm-tabbar", attr: { role: "tablist" } });
		for (const id of TAB_IDS) {
			const button = tabbar.createEl("button", {
				cls: "pm-tab",
				text: tabLabel(id),
				attr: { type: "button", role: "tab" },
			});
			this.tabButtons[id] = button;
			this.registerDomEvent(button, "click", () => {
				if (this.activeTab === id) return;
				this.activeTab = id;
				this.applyTab();
			});
		}
		this.mermaidStatusEl = tabbar.createSpan({ cls: "pm-tabbar__status" });

		const ganttHost = main.createDiv({ cls: "pm-gantt-host" });
		this.ganttHostEl = ganttHost;
		this.gantt = new GanttView(this, ganttHost, {
			onOpenNote: (path) => this.openNote(path),
			onEditProject: (path) => this.openEditorModal(path),
			onColorChange: (path, color) => void this.setProjectColor(path, color),
			onDatesChanged: (path, change) => void this.handleDatesChanged(path, change),
			onToggleSection: (key) => this.toggleSection(key),
			onHoverProject: (path) => this.hoverProject(path),
			onZoom: (direction, anchor) => this.zoomStep(direction, anchor),
			// 任务条配色来自设置，改完立刻重绘生效
			getBarColors: () => this.host.settings.ganttBarColors,
			// 顺序调整放在甘特侧栏（用户口径：面板只负责「看有哪些资料」）
			onReorderSections: (keys) => void this.reorderGroups(keys),
			onReorderProjects: (groupKey, paths) => void this.reorderProjects(groupKey, paths),
		});

		// Mermaid 预览：与甘特图同级的另一个 Tab 面板（默认隐藏，切过去才渲染）
		const mermaidHost = main.createDiv({ cls: "pm-mermaid-host is-hidden" });
		this.mermaidHostEl = mermaidHost;
		/*
		 * 里层再套一个元素：MermaidPanel 会把自己的 pm-mermaid 加到传给它的宿主上。
		 * 与甘特图同一条经验——Tab 面板的「显隐/占位」和面板自己的「内部排版」
		 * 不该写在同一个元素上，否则两边各自写的 flex 属性会互相覆盖。
		 */
		const mermaidInner = mermaidHost.createDiv();
		this.mermaidPanel = new MermaidPanel(this, this.host.app, mermaidInner, {
			getSource: () => this.mermaidSource(),
			getOptions: () => this.mermaidOptions(),
			onOptionsChange: (patch) => void this.handleMermaidOptions(patch),
			onExportCode: () => void this.exportMermaidCode(),
			onWriteToNote: () => this.writeToNote(),
			// 导出图片：面板把预览里的 svg 取出并转好载荷，这里只管落盘
			onExportImage: (payload) => void this.exportMermaidImage(payload),
		});
		this.applyTab();
	}

	// ────────────────────────────── 刷新管道 ──────────────────────────────

	/**
	 * 唯一的数据入口：索引 → 筛选 → 排序 → **一次分组** → 手动顺序 → 甘特模型 + 卡片 → 渲染。
	 *
	 * 左右联动的关键在这一行的结构上：分组只算一次，左侧卡片与右侧甘特分节
	 * 吃的是**同一份 GroupingResult**（分节顺序、分节归属、折叠 key 全部一致），
	 * 因此不会出现「左边按文件夹、右边按 objective」这种两边各说各话的情况。
	 */
	refresh(): void {
		if (this.gantt === null || this.groupPanel === null) return;

		const settings = this.host.settings;

		// 面板卡片字号：设置里存百分比（100 = 跟随主题），这里换算成倍率交给样式表。
		// 每次刷新都写一遍是有意的——改设置会走 onSettingsChanged → 刷新，所以这里就是生效点。
		this.rootEl?.style.setProperty("--pm-card-font-scale", String(settings.cardFontScale / 100));
		const all = this.host.getProjects();
		const today = todayIso();

		const filtered = applyFilters(all, this.filterState, { today });
		const sorted = sortProjects(filtered, this.sortMode);
		/*
		 * 不分组 + 时间档：长期项目没有时间边界，按时间排只会被
		 * 「无日期排最后」沉到列表尾，而它们恰恰是要一直盯着的——置顶
		 * （用户口径 2026-09-21）。
		 *
		 * 判定**不再带 panelMode**：原来多加了这一个条件，导致面板模式置顶、
		 * 侧边栏不置顶，同一批卡片换个视图顺序就变。置顶与否该由分组模式与排序档
		 * 决定，与卡片显示在哪无关（口径收在 shouldPinLongTerm）。
		 */
		const ordered = shouldPinLongTerm(this.groupingMode, this.sortMode)
			? longTermFirst(sorted)
			: sorted;

		// grouping-service 以 settings.defaultGrouping 决定模式：
		// 视图内的即时切换通过覆盖这一项实现，不必给服务加一层只在 UI 用的参数
		const grouped = groupProjects(ordered, { ...settings, defaultGrouping: this.groupingMode }, {
			folderNotes: this.host.getFolderNotes(),
			// 项目文档不是「资料」，用它把项目文档从资料计数里剔除
			projectPaths: all.map((item) => item.file.path),
		});
		const groups = applyManualOrderIfNeeded(grouped, this.groupingMode, this.sortMode, {
			groups: settings.manualGroupOrder,
			projects: settings.manualProjectOrder,
		});
		this.lastGroups = groups;

		const sections = toSectionSpecs(groups).map((spec) => ({
			...spec,
			collapsed: this.collapsedKeys.has(spec.key),
		}));

		const model = buildGanttModel(ordered, settings, today, {
			sections,
			/*
			 * 值分组（目标 / 领域）强制显示分节名：这时标题就是信息本身，而且左面板
			 * 一直显示它——甘特在只剩一节时藏掉标题，就成了「面板分组了、甘特没分组」
			 * （用户口径 2026-09-21）。
			 *
			 * folder / 不分组维持默认口径（单节标题常与组内项目重名，是纯噪声）。
			 */
			showSectionHeaders:
				this.groupingMode === "objective" || this.groupingMode === "area"
					? true
					: undefined,
			axisRange: this.resolveAxisRange(today) ?? undefined,
		});
		this.lastModel = model;

		// 甘特图（唯一的可编辑版本）与 Mermaid 预览共用这**一次**模型：
		// 预览就是它的投影，「联动一致」因此是结构上保证的，不需要任何同步逻辑
		this.lastGenerated = exportMermaid(model, settings);

		this.gantt.render(model, this.zoom, today, this.pendingAnchor ?? undefined);
		this.pendingAnchor = null;
		this.groupPanel.render(groups, {
			mode: this.groupingMode,
			maxNotes: settings.maxNotesPerProject,
			collapsedKeys: this.collapsedKeys,
			// 面板模式下甘特被整页顶掉：卡片不再挂「点击定位」的提示与行为
			canLocateInGantt: !this.panelMode,
			// 面板模式下卡片才有拖动手柄（顺序调整从甘特侧栏挪到卡片本身）
			panelMode: this.panelMode,
			// 面板模式下用底色区分「不会出现在甘特图上」的项目，原因悬停可见
			notOnGantt: new Map(
				(this.lastModel?.skipped ?? []).map((skip) => [skip.item.file.path, skip.reason]),
			),
		});
		this.filterBar?.update();
		this.renderIssues();
		this.renderStats(model, filtered.length, all.length, today);
		this.updateMermaidStatus();
		// 不在前台就跳过渲染：mermaid 在 display:none 的容器里量不到尺寸，渲染出来是坏的
		// （真需要时切过去，applyTab() 会补一次渲染）
		if (this.activeTab === "mermaid") this.mermaidPanel?.update();
	}

	/** 筛选栏选的区间同时决定时间轴范围（看哪一段 = 筛哪一段） */
	private resolveAxisRange(today: string): { start: string; end: string } | null {
		const range = this.filterState.dateRange;
		const resolved =
			range.preset === "custom"
				? { start: range.start, end: range.end }
				: resolveDateRange(range.preset, today);
		if (resolved.start === null || resolved.end === null) return null;
		return { start: resolved.start, end: resolved.end };
	}

	private patchState(patch: Partial<FilterState>): void {
		this.filterState = { ...this.filterState, ...patch };
		this.refresh();
	}

	private counts(): { shown: number; total: number } {
		const all = this.host.getProjects();
		const filtered = applyFilters(all, this.filterState, { today: todayIso() });
		return { shown: filtered.length, total: all.length };
	}

	/** 领域候选从项目集合动态收集（F2.2）：领域是单值，一个项目贡献一个候选 */
	private collectAreas(): string[] {
		const areas = new Set<string>();
		for (const item of this.host.getProjects()) {
			if (item.area !== null) areas.add(item.area);
		}
		return [...areas].sort();
	}

	/** 年度候选同样由数据决定：只列出真的有项目落在的年份 */
	private availableYears(): number[] {
		return collectYears(this.host.getProjects());
	}

	/**
	 * 当前活动笔记的领域（include/exclude 快捷档的参照值，F2.2）。
	 *
	 * 返回数组是因为筛选状态里那一格按「参照值集合」表示；但领域是单值（用户口径
	 * 2026-09-21），所以这里最多一个元素。读取走索引层同一口径——老笔记写成数组时
	 * 取第一个，免得「索引说属市场、快捷档说属市场+运营」这种自相矛盾。
	 */
	private currentNoteAreas(): string[] {
		const file = this.host.app.workspace.getActiveFile();
		if (file === null) return [];
		const frontmatter = readFrontmatterOf(this.host.app, file);
		const area = normalizeSingleValue(frontmatter[this.host.settings.fieldMapping.area]);
		return area === null ? [] : [area];
	}

	/** 年度筛选的人话描述（放在统计行里，让用户一眼知道列表为什么变短了） */
	private describeYearFilter(): string | null {
		// 文案口径收在 filter-service（「为什么看不见」的提示也用同一份，避免两处措辞走样）
		const label = describeYearState(this.filterState);
		return label === t("不限") ? null : label;
	}

	// ────────────────────────────── 联动与排序 ──────────────────────────────

	/** 折叠/展开分组：左右两侧共用 group key，一处折叠两处生效 */
	private toggleSection(key: string): void {
		if (this.collapsedKeys.has(key)) {
			this.collapsedKeys.delete(key);
		} else {
			this.collapsedKeys.add(key);
		}
		this.refresh();
	}

	/** 一键全部展开 / 全部收起 */
	private setAllCollapsed(collapsed: boolean): void {
		this.collapsedKeys.clear();
		if (collapsed) {
			for (const key of this.allGroupKeys()) this.collapsedKeys.add(key);
		}
		this.refresh();
	}

	/**
	 * 面板模式（用户口径 2026-09-20）：面板内容以卡片形式铺满整页，主区让位。
	 *
	 * 只切一个根 class、**不重渲染任何东西**：筛选、分组、折叠、滚动位置全留在原 DOM 里，
	 * 退出即原样回归。类挂在根容器上，所以「隐藏只对甘特有意义的工具栏控件」和
	 * 「面板铺满整页」两件事共用同一个开关。
	 *
	 * 唯一要手工保住的是甘特时间轴的滚动位置——祖先 `display:none` 会让浏览器
	 * 把滚动容器归零，不还原的话用户会觉得「跳回最左边」。
	 *
	 * 侧栏处于收起状态时不额外处理：CSS 里面板模式规则排在 `.pm-body--collapsed` 之后，
	 * 两者同开时以面板模式为准，退出后侧栏仍是收起的（状态没被改过）。
	 */
	private setPanelMode(enabled: boolean): void {
		if (enabled) this.ganttScroll = this.gantt?.captureScroll() ?? null;
		this.panelMode = enabled;
		this.rootEl?.toggleClass("pm-panel-mode", enabled);
		/*
		 * 必须重绘：卡片上的「点击在甘特图中定位」提示与点击钩子都跟着这个开关走
		 * （面板模式下甘特不在场，挂上去就是一张点了没反应的卡片）。
		 * 重绘放在还原滚动位置**之前**，否则重渲染会把刚还原的位置又冲掉。
		 */
		this.refresh();
		if (!enabled && this.ganttScroll !== null) {
			this.gantt?.restoreScroll(this.ganttScroll);
			this.ganttScroll = null;
		}
	}

	private allGroupKeys(): string[] {
		const groups = this.lastGroups;
		if (groups === null) return [];
		return [
			...groups.quickGroups.map((group) => group.folder),
			...groups.normalGroups.map((group) => group.key),
		];
	}

	/** 悬停联动：两侧都只是加/去一个 class，不走 refresh（避免每次移动指针都重渲染） */
	private hoverProject(path: string | null): void {
		this.gantt?.setLinkedProject(path);
		this.groupPanel?.setLinkedProject(path);
	}

	/** 「在甘特中定位」：滚动 + 定时高亮；项目不在甘特上时给出明确反馈而不是静默失败 */
	private focusProjectInGantt(path: string): void {
		// 点面板里的项目 = 明确要看甘特图：先切回甘特 Tab，再滚动定位
		if (this.activeTab !== "gantt") {
			this.activeTab = "gantt";
			this.applyTab();
		}
		const found = this.gantt?.scrollToProject(path) ?? false;
		if (found) return;
		const item = this.host.getProjects().find((p) => p.file.path === path);
		/*
		 * 不在图上时要说清是**哪一种**不在：长期项目有日期也不上图，
		 * 一律答「缺起止日期」就是在说假话，用户会去补一个根本不缺的日期。
		 * 长期项目那条顺带指向面板的「编辑」按钮——那是它唯一的界面入口。
		 * （cancelled 不再有特殊处理：它能不能上甘特图由状态筛选决定。）
		 */
		let reason = t("该项目缺起止日期，无法在甘特图上定位");
		if (item !== undefined && item.longTerm) {
			reason = t("该项目标记为长期项目，按设计不上甘特图（可在面板卡片上点「编辑」修改）");
		}
		new Notice(reason);
	}

	/**
	 * 拖动分组：记进设置并自动切到「手动排序」。
	 *
	 * 两个入口共用它——甘特侧栏拖分节、面板模式拖分组（用户口径 2026-09-21）。
	 * `keys` 都是**完整**的分组 key 顺序（面板那边把快速分区与普通分组拼成一份）。
	 */
	private async reorderGroups(keys: string[]): Promise<void> {
		const settings = this.host.settings;
		settings.manualGroupOrder = { ...settings.manualGroupOrder, [this.groupingMode]: keys };
		this.switchToManualSort();
		await this.host.persistSettings();
		this.refresh();
	}

	/**
	 * 拖动组内项目：key 带分组模式前缀，避免 folder 路径与 area 值撞车。
	 *
	 * `paths` 是甘特侧栏里的可见顺序，其中不含「已取消 / 缺日期」这类没上甘特图的项目，
	 * 所以先把它并回该分组的完整序列再落盘（否则被跳过的项目会被顶到组尾）。
	 */
	/** 把设置里的侧栏宽度写到分栏变量上（null = 回到样式表里的默认占比） */
	private applySidebarWidth(): void {
		const body = this.bodyEl;
		if (body === null) return;
		const width = this.host.settings.sidebarWidth;
		if (width === null) body.style.removeProperty("--pm-side-width");
		else body.style.setProperty("--pm-side-width", `${width}px`);
	}

	/**
	 * 侧栏宽度落盘（松手/键盘调整时才调，见 SplitResizer 的说明）。
	 *
	 * 宽度只影响布局、不影响索引，所以走 persistSettings（不触发全库重扫）。
	 */
	private async persistSidebarWidth(width: number): Promise<void> {
		const clamped = clampSplitWidth(width, SIDEBAR_WIDTH_RANGE.min, SIDEBAR_WIDTH_RANGE.max);
		if (this.host.settings.sidebarWidth === clamped) return;
		this.host.settings.sidebarWidth = clamped;
		await this.host.persistSettings();
	}

	private async reorderProjects(groupKey: string, paths: string[]): Promise<void> {
		const settings = this.host.settings;
		const key = projectOrderKey(this.groupingMode, groupKey);
		settings.manualProjectOrder = {
			...settings.manualProjectOrder,
			[key]: mergeVisibleOrder(this.groupProjectPaths(groupKey), paths),
		};
		this.switchToManualSort();
		await this.host.persistSettings();
		this.refresh();
	}

	/** 某个分组的全部项目路径（含未上甘特图的项目——甘特侧栏看不到它们） */
	private groupProjectPaths(groupKey: string): string[] {
		const groups = this.lastGroups;
		if (groups === null) return [];
		for (const group of groups.quickGroups) {
			if (group.folder === groupKey) return group.projects.map((item) => item.file.path);
		}
		for (const group of groups.normalGroups) {
			if (group.key === groupKey) return group.projects.map((item) => item.file.path);
		}
		return [];
	}

	private switchToManualSort(): void {
		if (this.sortMode === "manual") return;
		this.sortMode = "manual";
		new Notice(t("已切换为「手动排序」"));
	}

	// ────────────────────────────── 时间粒度 ──────────────────────────────

	/** Ctrl/Cmd + 加号 / 减号（用户要求；普通滚轮留给滚动，避免冲突） */
	private onKeyDown(evt: KeyboardEvent): void {
		if (!evt.ctrlKey && !evt.metaKey) return;
		if (evt.altKey) return;

		if (evt.key === "0" || evt.code === "Numpad0") {
			evt.preventDefault();
			this.resetZoom();
			return;
		}
		const zoomIn = evt.key === "=" || evt.key === "+" || evt.code === "NumpadAdd";
		const zoomOut = evt.key === "-" || evt.key === "_" || evt.code === "NumpadSubtract";
		if (!zoomIn && !zoomOut) return;
		evt.preventDefault();
		this.zoomStep(zoomIn ? 1 : -1, this.gantt?.centerAnchor() ?? null);
	}

	/** 视图内 Ctrl+滚轮 / 面板按钮 / 命令都走这里：+1 更细，-1 更粗 */
	zoomStep(direction: 1 | -1, anchor: ZoomAnchor | null): void {
		const index = ZOOM_LADDER.indexOf(this.zoom);
		const next = index + direction;
		// 到顶/到底就什么都不做，但也不弹提示——连按快捷键时刷屏很烦
		if (index === -1 || next < 0 || next >= ZOOM_LADDER.length) return;

		this.zoom = ZOOM_LADDER[next];
		this.pendingAnchor = anchor;
		if (this.zoomSelect !== null) this.zoomSelect.value = this.zoom;
		this.refresh();
	}

	/** 恢复默认粒度（筛选栏改区间时也会走这里，让「看哪一段」和「看多细」同步回到起点） */
	resetZoom(): void {
		this.zoom = this.host.settings.defaultZoom;
		this.pendingAnchor = null;
		if (this.zoomSelect !== null) this.zoomSelect.value = this.zoom;
		this.refresh();
		this.gantt?.scrollToStart();
	}

	/** 供命令面板调用的无参入口（插件命令注册用） */
	zoomInCommand(): void {
		this.zoomStep(1, this.gantt?.centerAnchor() ?? null);
	}

	zoomOutCommand(): void {
		this.zoomStep(-1, this.gantt?.centerAnchor() ?? null);
	}

	// ────────────────────────────── 渲染碎片 ──────────────────────────────

	private renderStats(model: GanttModel, shown: number, total: number, today: string): void {
		const stats = this.statsEl;
		if (stats === null) return;
		stats.empty();
		stats.createSpan({ text: `共 ${total} 个项目，当前筛选 ${shown} 个` });

		// 年度筛选是最容易让人困惑的一层（无日期的项目会被排除），所以把它的影响显式报出来，
		// 而不是让项目「悄悄消失」——用户看到数字才知道要动哪个条件。
		const yearLabel = this.describeYearFilter();
		if (yearLabel !== null) {
			const withoutYear = applyFilters(
				this.host.getProjects(),
				{ ...this.filterState, startYear: null, endYear: null },
				{ today },
			);
			const dropped = withoutYear.length - shown;
			stats.createSpan({
				cls: "pm-stats__hint",
				text:
					dropped > 0
						? `（年度筛选：${yearLabel}，另有 ${dropped} 个项目因年度不符未显示）`
						: `（年度筛选：${yearLabel}）`,
				attr: {
					title:
						t("年度筛选按项目的开始/截止日期所在年份严格匹配；没有对应日期的项目不会被计入任何年度。"),
				},
			});
		}

		/*
		 * 状态档是另一处「静默排除」：默认档「隐藏已完成」还会隐藏「取消」与「归档」
		 * （2026-09-21 报的 bug —— 把项目改成 cancelled 后它就不见了，界面没提过半个字）。
		 * 与年度提示同一处理：报出数字，用户才知道该动哪个条件。
		 */
		const allStatuses = presetToStatuses("all");
		if (this.filterState.statuses.length < allStatuses.length) {
			const preset = detectStatusPreset(this.filterState.statuses);
			// detectStatusPreset 把「自定义子集」也归为 all，这里得自己区分，
			// 否则会印出「状态档「全部」：另有 N 个未显示」这种自相矛盾的话
			const label = preset === "all" ? t("自定义") : statusPresetLabel(preset);
			const withoutStatusFilter = applyFilters(
				this.host.getProjects(),
				{ ...this.filterState, statuses: allStatuses },
				{ today },
			);
			const dropped = withoutStatusFilter.length - shown;
			if (dropped > 0) {
				stats.createSpan({
					cls: "pm-stats__hint",
					text: `（状态档「${label}」：另有 ${dropped} 个项目因状态未显示）`,
					attr: {
						title:
							t("「隐藏已完成」这一档同时还隐藏「取消」与「归档」；把状态档改成「全部」即可看到它们。"),
					},
				});
			}
		}

		if (model.skipped.length > 0) {
			const reasons = new Map<string, number>();
			for (const skip of model.skipped) {
				reasons.set(skip.reason, (reasons.get(skip.reason) ?? 0) + 1);
			}
			const parts: string[] = [];
			const noDates = reasons.get("no-dates");
			const longTerm = reasons.get("long-term");
			if (noDates !== undefined) parts.push(`缺日期 ${noDates}`);
			if (longTerm !== undefined) parts.push(`长期项目 ${longTerm}`);
			stats.createSpan({
				cls: "pm-stats__hint",
				text: t("（未上甘特图：{parts}）", { parts: parts.join("、") }),
				attr: {
					title:
						t("「缺日期」需补全起止日期；「长期项目」按设计只出现在面板（它没有确定的时间边界）"),
				},
			});
		}
		stats.createSpan({
			cls: "pm-stats__hint",
			text: t("时间粒度：{unit}刻度", { unit: zoomLabel(this.zoom) }),
		});
		stats.createSpan({
			cls: "pm-stats__hint",
			text: "Ctrl + / Ctrl - / Ctrl+滚轮 调整",
			attr: { title: "Ctrl+加号 更细、Ctrl+减号 更粗、Ctrl+0 恢复默认" },
		});
	}

	/** SPEC §2.3：非法数据显式提示修复，不静默纠正 */
	private renderIssues(): void {
		const host = this.issuesEl;
		if (host === null) return;
		host.empty();
		const issues = this.host.getIssues();
		const paths = Object.keys(issues);
		host.toggleClass("is-hidden", paths.length === 0);
		if (paths.length === 0) return;

		host.createDiv({
			cls: "pm-issues__title",
			text: `⚠️ ${paths.length} 个项目的元数据需要修复`,
		});
		const list = host.createEl("ul", { cls: "pm-issues__list" });
		for (const path of paths) {
			const entries = issues[path] ?? [];
			const li = list.createEl("li", { cls: "pm-issues__item" });
			const link = li.createEl("a", {
				cls: "internal-link",
				text: leafName(path),
				href: path,
			});
			link.dataset.path = path;
			this.registerDomEvent(link, "click", (evt) => {
				evt.preventDefault();
				this.openNote(path);
			});
			li.createSpan({
				cls: "pm-issues__detail",
				text: entries.map(describeIssue).join("；"),
			});
		}
	}

	/**
	 * 右键菜单换色（用户要求 2026-09-20）：写回 frontmatter 的 color 字段。
	 *
	 * `null` 走的是同一套写入口——`patchFrontmatter` 见到 null 会**删字段**，
	 * 于是「默认（按状态）」就是把自定义色清掉，而不是写一个空串进去。
	 */
	private async setProjectColor(path: string, color: string | null): Promise<void> {
		try {
			await this.host.service.patchFrontmatter(path, {
				[this.host.settings.fieldMapping.color]: color,
			});
		} catch (error) {
			new Notice(`颜色写回失败：${describeError(error)}`);
		}
		// 立刻刷新一次让颜色马上变；索引事件随后还会再刷一次（已被 scheduleRefresh 合并）
		this.host.requestRefresh();
	}

	// ────────────────────────────── 动作 ──────────────────────────────

	/** F1.3：新 leaf 打开，不替换当前视图 */
	private openNote(path: string): void {
		void this.host.app.workspace.openLinkText(path, "", true);
	}

	private openEditorModal(path: string): void {
		new ProjectEditorModal(this.host.app, path, {
			getSettings: () => this.host.settings,
			getItem: (target) =>
				this.host.getProjects().find((item) => item.file.path === target) ?? null,
			// 已有值候选现算（每次打开弹窗一次）：索引一变，下拉里的值就是最新的
			getSuggestions: () => collectSuggestions(this.host.getProjects()),
			save: (target, patch) => this.host.service.patchFrontmatter(target, patch),
			clearProjectType: (target) =>
				this.host.service.patchFrontmatter(target, {
					[this.host.settings.fieldMapping.type]: null,
				}),
			openNote: (target) => this.openNote(target),
			onDone: () => {
				this.host.requestRefresh();
				this.explainIfHidden(path);
			},
		}).open();
	}

	/**
	 * 编辑保存后，若该项目在当前筛选下看不到，明确说出原因。
	 *
	 * 不做这件事的话，「把状态改成取消」的直观感受就是「项目被我改没了」——
	 * 默认状态档会把它筛掉，而界面上没有任何一处提到这一点（2026-09-21 报的 bug）。
	 */
	private explainIfHidden(path: string): void {
		const item = this.host.getProjects().find((candidate) => candidate.file.path === path);
		// 索引里已经没有了：那不是筛选的问题（例如「删除项目」清掉了 type），不在这里解释
		if (item === undefined) return;

		const filterReason = explainHidden(item, this.filterState, { today: todayIso() });
		if (filterReason !== null) {
			new Notice(`「${item.file.name}」已保存，但当前看板上看不到它：${filterReason}`);
			return;
		}

		/*
		 * 筛选没挡它，就再看**甘特模型**跳过了它没有（取消 / 长期 / 缺日期）。
		 *
		 * 这才是「把项目改成取消就找不到」的原因（2026-09-21 报的 bug）：面板里它一直都在，
		 * 只是甘特图上没有它——而在这之前只有统计行的小字提过这件事。
		 * 判断直接读 lastModel.skipped，不在这里重写规则：跳过口径只有 gantt-model 一处。
		 */
		const skip = this.lastModel?.skipped.find((entry) => entry.item.file.path === path);
		if (skip !== undefined) {
			new Notice(
				t("「{name}」已保存，但甘特图上不会显示它：{reason}", {
					name: item.file.name,
					reason: ganttSkipMessage(skip.reason),
				}),
			);
		}
	}

	private openNewProjectModal(): void {
		new NewProjectModal(this.host.app, {
			getSettings: () => this.host.settings,
			// 与编辑弹窗同一份候选值：能在新建时选到已有值，才不用事后改
			getSuggestions: () => collectSuggestions(this.host.getProjects()),
			createProject: (input) => this.host.service.createProject(input),
			openNote: (path) => this.openNote(path),
			onDone: () => this.host.requestRefresh(),
		}).open();
	}

	/** F1.4：拖拽落盘——只写被拖动的那一侧，且尊重 end_date fallback */
	private async handleDatesChanged(
		path: string,
		change: { start?: string; end?: string },
	): Promise<void> {
		try {
			await this.host.service.writeDates(path, this.host.settings.fieldMapping, change);
		} catch (error) {
			new Notice(`日期写回失败：${describeError(error)}`);
		}
	}

	// ────────────────────────────── Mermaid Tab ──────────────────────────────

	private mermaidOptions(): MermaidOptions {
		const settings = this.host.settings;
		return {
			todayMarker: settings.mermaidTodayMarker,
			excludeWeekends: settings.mermaidExcludeWeekends,
			excludeDates: settings.mermaidExcludeDates,
			includeDates: settings.mermaidIncludeDates,
		};
	}

	/**
	 * 当前要展示/导出的 mermaid 全文。
	 *
	 * 没有草稿一说：甘特图是唯一可编辑版本，这里永远是它的最新投影（用户口径 2026-09-20）。
	 */
	private mermaidSource(): string {
		if (this.lastGenerated.length > 0) return this.lastGenerated;
		// 首帧兜底（refresh 尚未跑过）
		const model = this.lastModel;
		if (model === null) return "```mermaid\ngantt\n```";
		return exportMermaid(model, this.host.settings);
	}

	private async handleMermaidOptions(patch: Partial<MermaidOptions>): Promise<void> {
		const settings = this.host.settings;
		if (patch.todayMarker !== undefined) settings.mermaidTodayMarker = patch.todayMarker;
		if (patch.excludeWeekends !== undefined) {
			settings.mermaidExcludeWeekends = patch.excludeWeekends;
		}
		if (patch.excludeDates !== undefined) settings.mermaidExcludeDates = patch.excludeDates;
		if (patch.includeDates !== undefined) settings.mermaidIncludeDates = patch.includeDates;
		await this.host.persistSettings();
		// 选项变了要一份新的导出；预览重新生成即与甘特图重新对齐
		this.lastGenerated = this.generatedMermaid();
		this.mermaidPanel?.update();
		this.updateMermaidStatus();
	}

	/** 由当前甘特模型生成 mermaid（选项变化后立即重算，不必等下一次 refresh） */
	private generatedMermaid(): string {
		const model = this.lastModel;
		return model === null ? "" : exportMermaid(model, this.host.settings);
	}

	/** 「导出代码」：把当前预览的源码复制走（面板上唯一的按钮） */
	private async exportMermaidCode(): Promise<void> {
		const count = exportableRows(this.lastModel).length;
		if (count === 0) {
			new Notice(t("当前没有展开的项目可导出（折叠的分节不会进导出）。"));
			return;
		}
		const ok = await copyToClipboard(this.mermaidSource(), this.contentEl.ownerDocument);
		new Notice(
			ok
				? `已复制 Mermaid 代码（${count} 个项目）`
				: t("复制失败：剪贴板不可用，请改用「写入笔记」"),
		);
	}

	/** F1.7「写入笔记」：写入指定笔记的落点标记之间 */
	private writeToNote(): void {
		if (exportableRows(this.lastModel).length === 0) {
			new Notice(t("当前没有展开的项目可导出（折叠的分节不会进导出）。"));
			return;
		}
		new MermaidTargetModal(this.host.app, (file) => {
			void this.exportToNote(file.path);
		}).open();
	}

	private async exportToNote(path: string): Promise<void> {
		const settings = this.host.settings;
		const block = wrapInMarkers(this.mermaidSource(), settings);
		const result = await this.host.service.replaceMarkerBlock(
			path,
			block,
			settings.mermaidMarkerStart,
			settings.mermaidMarkerEnd,
		);
		new Notice(result.ok ? `已写入 ${leafName(path)}` : result.message);
	}

	/**
	 * 导出 Mermaid 预览的图片（用户口径 2026-09-21）。
	 *
	 * 落点用 Obsidian 自己的「附件默认位置」配置（读不到就退到 vault 根）：
	 * 那是用户**已经配过**的地方，插件没理由再要一个自己的目录参数。
	 * 文件名带时间戳，同名自动加序号——导出的常态是连着导好几版，覆盖掉上一版比多一个文件更糟。
	 *
	 * 写完把**路径复制进剪贴板**（用户口径 2026-09-21）：附件目录动辄几百个文件，
	 * 手工翻找很难受；有路径就能直接粘进快速切换/搜索里定位。
	 */
	 private async exportMermaidImage(payload: MermaidImageExport): Promise<void> {
	 const app = this.host.app;
	 const folder = resolveAttachmentFolder(
	 readAttachmentSetting(app),
	 app.workspace.getActiveFile()?.parent?.path ?? null,
	 );
	 const name = exportImageName("甘特图", payload.format, new Date());
	 try {
	 // 附件目录可能还没建过（配置里写的是一个新路径）
	 if (folder.length > 0 && app.vault.getAbstractFileByPath(folder) === null) {
	 await app.vault.createFolder(folder);
	 }
	 const path = this.uniqueExportPath(folder, name);
	 if (typeof payload.data === "string") {
	 await app.vault.create(path, payload.data);
	 } else {
	 await app.vault.createBinary(path, payload.data);
	 }
	 /*
	 * 复制失败**不改判定**：文件已经写好了，那才是这次操作的主体；
	 * 剪贴板只是「更好找」的顺手动作，失败了就在提示里说清、让用户回附件目录取。
	 */
	 const copied = await copyToClipboard(path, this.contentEl.ownerDocument);
	 new Notice(
	 copied
	 ? `已导出并复制路径：${path}`
	 : `已导出 ${path}（复制路径失败，请到附件目录查找）`,
	 );
	 } catch (error) {
	 new Notice(`导出失败：${error instanceof Error ? error.message : String(error)}`);
	 }
	 }

	/** 同名文件已存在就换 `-2`、`-3`……（不覆盖用户已有的导出） */
	private uniqueExportPath(folder: string, name: string): string {
		const join = (fileName: string): string =>
			normalizePath(folder.length === 0 ? fileName : `${folder}/${fileName}`);
		const dot = name.lastIndexOf(".");
		const base = dot === -1 ? name : name.slice(0, dot);
		const ext = dot === -1 ? "" : name.slice(dot);
		for (let index = 1; index < 1000; index += 1) {
			const candidate = join(index === 1 ? name : `${base}-${index}${ext}`);
			if (this.host.app.vault.getAbstractFileByPath(candidate) === null) return candidate;
		}
		return join(name);
	}

	/** 供测试脚本/外部命令读取当前视图状态（不含 DOM） */
	getState(): {
		filter: FilterState;
		zoom: ZoomMode;
		grouping: GroupingMode;
		sort: SortMode;
		/** 主区当前显示的那一块（甘特图 / Mermaid 预览，同级 Tab） */
		tab: TabId;
	} {
		return {
			filter: this.filterState,
			zoom: this.zoom,
			grouping: this.groupingMode,
			sort: this.sortMode,
			tab: this.activeTab,
		};
	}
}

// ────────────────────────────── 工具 ──────────────────────────────

/** metadataCache 的 frontmatter 是 any：这里收敛成 unknown 再做一次类型收窄 */
function readFrontmatterOf(app: App, file: TFile): Record<string, unknown> {
	const raw: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
	return raw as Record<string, unknown>;
}

function leafName(path: string): string {
	const segments = path.split("/");
	return (segments[segments.length - 1] ?? path).replace(/\.md$/, "");
}

function describeIssue(issue: DataIssue): string {
	const field = issue.field;
	if (issue.reason === "unknown-status") {
		return `${field}「${issue.raw}」不是已知状态`;
	}
	if (issue.reason === "invalid-color") {
		return `${field}「${issue.raw}」不是可识别的颜色（支持 #hex / rgb() / var(--x) / 颜色名）`;
	}
	return `${field}「${issue.raw}」不是合法日期`;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 剪贴板：能力缺失或权限被拒时返回 false，由调用方提示降级路径 */
async function copyToClipboard(text: string, doc: Document): Promise<boolean> {
	const clipboard = doc.defaultView?.navigator.clipboard;
	if (clipboard === undefined) return false;
	try {
		await clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
