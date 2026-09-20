import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { buildGanttModel, GanttModel } from "../gantt/gantt-model";
import { exportMermaid, wrapInMarkers } from "../gantt/mermaid-export";
import { GanttView } from "../gantt/gantt-view";
import { MermaidTargetModal } from "../modals/mermaid-target-modal";
import { NewProjectModal } from "../modals/new-project-modal";
import { ProjectEditorModal } from "../modals/project-editor-modal";
import { FilterBar } from "../panels/filter-bar";
import { GroupPanel } from "../panels/group-panel";
import { DataIssue } from "../services/project-item";
import { ProjectService } from "../services/project-service";
import {
	applyFilters,
	collectYears,
	defaultFilterState,
	initialFilterState,
	FilterState,
	sortProjects,
	SortMode,
} from "../services/filter-service";
import {
	groupProjects,
	GroupingResult,
	NoteLink,
	toSectionSpecs,
} from "../services/grouping-service";
import {
	GroupingMode,
	ProjectItem,
	ProjectMasterSettings,
	ZoomMode,
} from "../types";
import { todayIso } from "../utils/date";

/** 视图类型 ID：pm- 前缀保证不与其他插件的 view type 冲突（agent.md §2.1） */
export const VIEW_TYPE_PM_DASHBOARD = "pm-dashboard-view";

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
}

/**
 * Dashboard 主视图（SPEC §3/F5）—— 布局组装与生命周期。
 *
 * 单向数据流（§3.1）：
 *   frontmatter → 索引/规范化 → filter/grouping 管道 → 渲染
 *   UI 编辑 → processFrontMatter → 事件驱动 → 索引 → 再渲染
 *
 * 本文件只做「组装 + 事件转发」，不含任何业务规则：
 * 过滤在 filter-service、分组在 grouping-service、甘特模型在 gantt-model、
 * 写回在 project-service、绘制在 gantt-view / group-panel / filter-bar。
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
	private sideCollapsed = false;
	/**
	 * 折叠的分组 key（folder 模式是文件夹路径，值模式是 objective/area 值）。
	 * 一份状态同时喂给左面板卡片与甘特分节——两处折叠永远一致。
	 */
	private readonly collapsedKeys = new Set<string>();

	private filterBar: FilterBar | null = null;
	private groupPanel: GroupPanel | null = null;
	private gantt: GanttView | null = null;

	private bodyEl: HTMLElement | null = null;
	private ganttHostEl: HTMLElement | null = null;
	private issuesEl: HTMLElement | null = null;
	private statsEl: HTMLElement | null = null;
	private groupingSelect: HTMLSelectElement | null = null;
	private zoomSelect: HTMLSelectElement | null = null;

	private lastModel: GanttModel | null = null;

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
		return "layout-dashboard";
	}

	// ────────────────────────────── 生命周期 ──────────────────────────────

	async onOpen(): Promise<void> {
		// 根容器：pm- 前缀，全部样式限制在此作用域内（agent.md §2.1/§2.2）
		const root = this.contentEl.createDiv({ cls: "pm-dashboard-root" });
		this.buildToolbar(root);
		this.buildFilterBar(root);
		this.issuesEl = root.createDiv({ cls: "pm-issues" });
		this.buildBody(root);
		this.statsEl = root.createDiv({ cls: "pm-stats" });

		this.refresh();
	}

	async onClose(): Promise<void> {
		// 视图自有资源在此收口；不 detach leaves，不跨视图清理
		this.gantt?.destroy();
		this.gantt = null;
		this.filterBar = null;
		this.groupPanel = null;
		this.contentEl.empty();
	}

	// ────────────────────────────── 布局 ──────────────────────────────

	private buildToolbar(root: HTMLElement): void {
		const bar = root.createDiv({ cls: "pm-toolbar" });
		bar.createEl("h2", { cls: "pm-toolbar__title", text: "项目中心" });

		const actions = bar.createDiv({ cls: "pm-toolbar__actions" });

		this.addButton(actions, "新建项目", () => this.openNewProjectModal());
		this.addButton(actions, "刷新", () => this.refresh());

		const grouping = actions.createEl("select", {
			cls: "dropdown pm-toolbar__select",
			attr: { "aria-label": "分组依据" },
		});
		for (const [value, label] of [
			["folder", "按文件夹分组"],
			["objective", "按目标分组"],
			["area", "按领域分组"],
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

		const zoom = actions.createEl("select", {
			cls: "dropdown pm-toolbar__select",
			attr: { "aria-label": "甘特缩放" },
		});
		for (const [value, label] of [
			["day", "日"],
			["week", "周"],
			["month", "月"],
		] as [ZoomMode, string][]) {
			zoom.createEl("option", { value, text: label });
		}
		zoom.value = this.zoom;
		this.zoomSelect = zoom;
		this.registerDomEvent(zoom, "change", () => {
			this.zoom = zoom.value as ZoomMode;
			this.refresh();
		});

		this.addButton(actions, "复制 Mermaid", () => void this.copyMermaid());
		this.addButton(actions, "导出到笔记", () => this.openExportModal());
		this.addButton(actions, this.sideCollapsed ? "展开面板" : "收起面板", (button) => {
			this.sideCollapsed = !this.sideCollapsed;
			this.bodyEl?.toggleClass("pm-body--collapsed", this.sideCollapsed);
			button.setText(this.sideCollapsed ? "展开面板" : "收起面板");
		});
	}

	private addButton(
		host: HTMLElement,
		label: string,
		onClick: (button: HTMLButtonElement) => void,
	): void {
		const button = host.createEl("button", {
			cls: "pm-btn",
			text: label,
			attr: { type: "button" },
		});
		this.registerDomEvent(button, "click", () => onClick(button));
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
			setDateRange: (dateRange) => this.patchState({ dateRange }),
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
		this.groupPanel = new GroupPanel(this, side, {
			onOpenNote: (path) => this.openNote(path),
			onFocusProject: (path) => this.focusProjectInGantt(path),
			onEditProject: (path) => this.openEditorModal(path),
			onToggleCollapse: (key) => this.toggleSection(key),
			onHoverProject: (path) => this.hoverProject(path),
		});

		const main = body.createDiv({ cls: "pm-main" });
		const ganttHost = main.createDiv({ cls: "pm-gantt-host" });
		this.ganttHostEl = ganttHost;
		this.gantt = new GanttView(this, ganttHost, {
			onOpenNote: (path) => this.openNote(path),
			onEditProject: (path) => this.openEditorModal(path),
			onDatesChanged: (path, change) => void this.handleDatesChanged(path, change),
			onToggleSection: (key) => this.toggleSection(key),
			onHoverProject: (path) => this.hoverProject(path),
		});
	}

	// ────────────────────────────── 刷新管道 ──────────────────────────────

	/**
	 * 唯一的数据入口：索引 → 筛选 → 排序 → **一次分组** → 甘特模型 + 卡片 → 渲染。
	 *
	 * 左右联动的关键在这一行的结构上：分组只算一次，左侧卡片与右侧甘特分节
	 * 吃的是**同一份 GroupingResult**（分节顺序、分节归属、折叠 key 全部一致），
	 * 因此不会出现「左边按文件夹、右边按 objective」这种两边各说各话的情况。
	 */
	refresh(): void {
		if (this.gantt === null || this.groupPanel === null) return;

		const settings = this.host.settings;
		const all = this.host.getProjects();
		const today = todayIso();

		const filtered = applyFilters(all, this.filterState, { today });
		const sorted = sortProjects(filtered, this.sortMode);

		// grouping-service 以 settings.defaultGrouping 决定模式：
		// 视图内的即时切换通过覆盖这一项实现，不必给服务加一层只在 UI 用的参数
		const groups: GroupingResult = groupProjects(
			sorted,
			{ ...settings, defaultGrouping: this.groupingMode },
			{
				folderNotes: this.host.getFolderNotes(),
				// 项目文档不是「资料」，用它把项目文档从资料计数里剔除
				projectPaths: all.map((item) => item.file.path),
			},
		);

		const sections = toSectionSpecs(groups).map((spec) => ({
			...spec,
			collapsed: this.collapsedKeys.has(spec.key),
		}));

		const model = buildGanttModel(sorted, settings, today, { sections });
		this.lastModel = model;

		this.gantt.render(model, this.zoom, today);
		this.groupPanel.render(groups, {
			mode: this.groupingMode,
			maxNotes: settings.maxNotesPerProject,
			collapsedKeys: this.collapsedKeys,
		});
		this.filterBar?.update();
		this.renderIssues();
		this.renderStats(model, filtered.length, all.length, today);
	}

	/** 折叠/展开分组：左右两侧共用 group key，一处折叠两处生效 */
	private toggleSection(key: string): void {
		if (this.collapsedKeys.has(key)) {
			this.collapsedKeys.delete(key);
		} else {
			this.collapsedKeys.add(key);
		}
		this.refresh();
	}

	/** 悬停联动：两侧都只是加/去一个 class，不走 refresh（避免每次移动指针都重渲染） */
	private hoverProject(path: string | null): void {
		this.gantt?.setLinkedProject(path);
		this.groupPanel?.setLinkedProject(path);
	}

	/** 「在甘特中定位」：滚动 + 定时高亮；项目不在甘特上时给出明确反馈而不是静默失败 */
	private focusProjectInGantt(path: string): void {
		const found = this.gantt?.scrollToProject(path) ?? false;
		if (found) return;
		const item = this.host.getProjects().find((p) => p.file.path === path);
		const reason =
			item !== undefined && item.status === "cancelled"
				? "该项目已取消，按设置不上甘特图"
				: "该项目缺起止日期，无法在甘特图上定位";
		new Notice(reason);
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

	/** 年度筛选的人话描述（放在统计行里，让用户一眼知道列表为什么变短了） */
	private describeYearFilter(): string | null {
		const { startYear, endYear } = this.filterState;
		if (startYear === null && endYear === null) return null;
		const parts: string[] = [];
		if (startYear !== null) parts.push(`开始 ${startYear} 年`);
		if (endYear !== null) parts.push(`结束 ${endYear} 年`);
		return parts.join(" / ");
	}

	/** area 候选从项目集合动态收集（F2.2，现有脚本行为） */
	private collectAreas(): string[] {
		const areas = new Set<string>();
		for (const item of this.host.getProjects()) {
			for (const area of item.area) areas.add(area);
		}
		return [...areas].sort();
	}

	/** 年度候选同样由数据决定：只列出真的有项目落在的年份 */
	private availableYears(): number[] {
		return collectYears(this.host.getProjects());
	}

	/** 当前活动笔记的 area（include/exclude 快捷档的参照值，F2.2） */
	private currentNoteAreas(): string[] {
		const file = this.host.app.workspace.getActiveFile();
		if (file === null) return [];
		const frontmatter = readFrontmatterOf(this.host.app, file);
		const raw = frontmatter[this.host.settings.fieldMapping.area];
		if (typeof raw === "string") return raw.trim().length > 0 ? [raw.trim()] : [];
		if (Array.isArray(raw)) {
			return raw.filter((entry): entry is string => typeof entry === "string");
		}
		return [];
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
						"年度筛选按项目的开始/截止日期所在年份严格匹配；没有对应日期的项目不会被计入任何年度。",
				},
			});
		}

		if (model.skipped.length > 0) {
			const reasons = new Map<string, number>();
			for (const skip of model.skipped) {
				reasons.set(skip.reason, (reasons.get(skip.reason) ?? 0) + 1);
			}
			const parts: string[] = [];
			const cancelled = reasons.get("cancelled");
			const noDates = reasons.get("no-dates");
			if (cancelled !== undefined) parts.push(`已取消 ${cancelled}`);
			if (noDates !== undefined) parts.push(`缺日期 ${noDates}`);
			stats.createSpan({
				cls: "pm-stats__hint",
				text: `（未上甘特图：${parts.join("、")}）`,
				attr: { title: "「已取消」默认不上甘特图；「缺日期」需补全起止日期" },
			});
		}
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
			save: (target, patch) => this.host.service.patchFrontmatter(target, patch),
			clearProjectType: (target) =>
				this.host.service.patchFrontmatter(target, {
					[this.host.settings.fieldMapping.type]: null,
				}),
			openNote: (target) => this.openNote(target),
			onDone: () => this.host.requestRefresh(),
		}).open();
	}

	private openNewProjectModal(): void {
		new NewProjectModal(this.host.app, {
			getSettings: () => this.host.settings,
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
			await this.host.service.writeDates(
				path,
				this.host.settings.fieldMapping,
				change,
			);
		} catch (error) {
			new Notice(`日期写回失败：${describeError(error)}`);
		}
	}

	/** F1.7：导出当前视图状态（已筛选/分组/排序）为 mermaid 并复制 */
	private async copyMermaid(): Promise<void> {
		const model = this.lastModel;
		if (model === null) return;
		const code = exportMermaid(model, this.host.settings);
		const ok = await copyToClipboard(code, this.contentEl.ownerDocument);
		new Notice(
			ok
				? `已复制 Mermaid 代码（${model.rows.length} 个项目）`
				: "复制失败：剪贴板不可用，请改用「导出到笔记」",
		);
	}

	/** F1.7 增强项：写入指定笔记的标记块之间 */
	private openExportModal(): void {
		const model = this.lastModel;
		if (model === null) return;
		if (model.rows.length === 0) {
			new Notice("当前视图没有可导出的项目。");
			return;
		}
		new MermaidTargetModal(this.host.app, (file) => {
			void this.exportToNote(file.path, model);
		}).open();
	}

	private async exportToNote(path: string, model: GanttModel): Promise<void> {
		const settings = this.host.settings;
		const block = wrapInMarkers(exportMermaid(model, settings), settings);
		const result = await this.host.service.replaceMarkerBlock(
			path,
			block,
			settings.mermaidMarkerStart,
			settings.mermaidMarkerEnd,
		);
		new Notice(result.ok ? `已写入 ${leafName(path)}` : result.message);
	}

	/** 供测试脚本/外部命令读取当前视图状态（不含 DOM） */
	getState(): { filter: FilterState; zoom: ZoomMode; grouping: GroupingMode } {
		return { filter: this.filterState, zoom: this.zoom, grouping: this.groupingMode };
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
