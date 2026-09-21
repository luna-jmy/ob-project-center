import { getIconIds, moment, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DashboardHost, DashboardView, VIEW_TYPE_PM_DASHBOARD } from "./views/dashboard-view";
import { pickViewIcon } from "./utils/icon";
import { ProjectMasterSettingTab } from "./settings";
import { ProjectService } from "./services/project-service";
import {
	isPathInScope,
	ProjectIndex,
	toFileInfo,
} from "./services/project-index";
import { DataIssue, ProjectFileInfo } from "./services/project-item";
import { applyLanguageSetting, detectLocale, t } from "./i18n";
import { NoteLink } from "./services/grouping-service";
import { migrateSettings, withConfigDir } from "./settings-migration";
import { DEFAULT_SETTINGS, ProjectItem, ProjectMasterSettings } from "./types";

/** 事件合并窗口：metadataCache 在保存时可能连续触发多次 */
const REFRESH_DEBOUNCE_MS = 250;
/** 初始索引分批大小：大 vault 下每批之间让出主线程，保证 UI 不卡 */
const INDEX_CHUNK_SIZE = 400;

/**
 * Project Master — 薄装配层（SPEC §3）。
 *
 * 职责边界：只做「注册、事件接线、索引编排、把数据递给视图」。
 * 业务规则全部在 services/（纯函数）、绘制全部在 views/panels/gantt。
 *
 * 生命周期约束（技能 compatibility.md）：
 * - `onload` 只做轻量注册；全库扫描推迟到 `onLayoutReady` 之后，分批且可中止；
 * - 所有事件走 `registerEvent`，定时器走 `register`，视图经 `registerView` 工厂创建；
 * - `onunload` **不** detach leaves（避免破坏 Obsidian 的布局恢复）。
 */
export default class ProjectMasterPlugin extends Plugin implements DashboardHost {
	settings: ProjectMasterSettings = DEFAULT_SETTINGS;
	service!: ProjectService;

	private index: ProjectIndex | null = null;
	/** 索引代次：设置变更/重新扫描时递增，用于中止过期的分批扫描 */
	private indexGeneration = 0;
	private refreshTimer: number | null = null;
	private folderNotesCache: Record<string, NoteLink[]> | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		// 界面语言要在任何视图/设置页渲染之前定下来（否则第一屏文案会用初值）
		this.applyUiLanguage();
		this.service = new ProjectService(this.app);

		this.registerView(
			VIEW_TYPE_PM_DASHBOARD,
			(leaf: WorkspaceLeaf) => new DashboardView(leaf, this),
		);

		/*
		 * 不注册默认快捷键（agent.md via 技能）。
		 * 图标走 `pickViewIcon` 挑：原先写死的 `layout-dashboard` 正是 Obsidian 内置
		 * 「白板（Canvas）」的图标，侧栏上两个图标撞脸（用户口径 2026-09-20）。
		 */
		this.addRibbonIcon(pickViewIcon(getIconIds()), t("打开项目中心"), () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-dashboard",
			name: t("打开项目中心"),
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: "rebuild-index",
			name: t("重建项目索引"),
			callback: () => {
				void this.bootstrap();
			},
		});

		// 时间粒度的命令入口：**不注册默认快捷键**（技能要求），
		// 用户在「设置 → 快捷键」里自己绑；视图内也支持 Ctrl +/- 与 Ctrl+滚轮。
		this.addCommand({
			id: "timeline-zoom-in",
			name: t("时间轴：放大（更细）"),
			callback: () => this.forEachDashboard((view) => view.zoomInCommand()),
		});
		this.addCommand({
			id: "timeline-zoom-out",
			name: t("时间轴：缩小（更粗）"),
			callback: () => this.forEachDashboard((view) => view.zoomOutCommand()),
		});
		this.addCommand({
			id: "timeline-zoom-reset",
			name: t("时间轴：恢复缩放"),
			callback: () => this.forEachDashboard((view) => view.resetZoom()),
		});

		this.addSettingTab(new ProjectMasterSettingTab(this.app, this));

		this.registerIndexEvents();

		// 重活推迟到布局就绪之后（技能：onload 不做全库扫描）
		this.app.workspace.onLayoutReady(() => {
			void this.bootstrap();
		});

		this.register(() => {
			if (this.refreshTimer !== null) {
				this.app.workspace.containerEl.ownerDocument.defaultView?.clearTimeout(
					this.refreshTimer,
				);
				this.refreshTimer = null;
			}
		});
	}

	onunload(): void {
		// 按技能要求：不在 onunload 中 detach leaves，避免破坏布局恢复
		this.index = null;
		this.folderNotesCache = null;
	}

	// ────────────────────────────── 设置 ──────────────────────────────

	async loadSettings(): Promise<void> {
		const data: unknown = await this.loadData();
		// 迁移是「全函数」：永不抛错，逐字段降级，失败不丢用户其他配置（SPEC §5.5）
		this.settings = migrateSettings(data);
		// 配置目录不硬编码 .obsidian，运行时以 Vault#configDir 为准
		this.settings = withConfigDir(this.settings, this.app.vault.configDir);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** 设置变更后的统一收口：污染全部缓存并重扫（scanFolders/字段映射都可能变） */
	async onSettingsChanged(): Promise<void> {
		await this.saveSettings();
		this.folderNotesCache = null;
		await this.bootstrap();
	}

	/**
	 * 把「界面语言」设置落到运行时（用户口径 2026-09-21）。
	 *
	 * 探测宿主语言（`moment.locale()` —— 宿主把界面语言同步给了 moment）与套用设置
	 * 收在同一处：onload 与设置页共用，避免两处各写一份解析规则。
	 *
	 * @returns 语言是否真的变了；变了调用方要重渲染已开着的视图
	 */
	applyUiLanguage(): boolean {
		return applyLanguageSetting(this.settings.uiLanguage, detectLocale(moment.locale()));
	}

	// ────────────────────────────── 索引编排 ──────────────────────────────

	/**
	 * 全量重扫。分批 + 可中止：设置变更或视图关闭后，过期批次会自行退出，
	 * 不会把旧配置的索引结果写进新状态（技能：延迟回调要检查是否仍有效）。
	 */
	private async bootstrap(): Promise<void> {
		const generation = ++this.indexGeneration;
		const files = this.app.vault.getMarkdownFiles();
		const scoped: ProjectFileInfo[] = [];

		for (let offset = 0; offset < files.length; offset += INDEX_CHUNK_SIZE) {
			if (generation !== this.indexGeneration) return;
			for (const file of files.slice(offset, offset + INDEX_CHUNK_SIZE)) {
				// 预筛只保留范围内文件，rebuild 本身就不会做无谓的 frontmatter 读取
				if (isPathInScope(file.path, this.settings)) {
					scoped.push(toFileInfo(file.path));
				}
			}
			await this.yieldToEventLoop();
		}
		if (generation !== this.indexGeneration) return;

		// 每次重建都换一个 ProjectIndex 实例：settings 是构造时捕获的，
		// 复用实例会带着旧设置继续索引（字段映射/扫描目录变更后会不一致）。
		this.index = new ProjectIndex(
			scoped,
			(path) => this.readFrontmatter(path),
			this.settings,
		);
		this.index.rebuild();
		this.requestRefresh();
	}

	private registerIndexEvents(): void {
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				this.index?.update(file.path);
				this.scheduleRefresh();
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on("deleted", (file) => {
				this.index?.remove(file.path);
				this.folderNotesCache = null;
				this.scheduleRefresh();
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					// 搬运而不是重读：重命名不改 frontmatter，重读反而可能读到
					// 还没跟上新路径的缓存（见 ProjectIndex.rename 的注释）
					this.index?.rename(oldPath, file.path);
				} else {
					// 文件夹改名：整棵子树都挪了，增量处理太容易漏，直接重建索引
					this.index?.remove(oldPath);
					void this.bootstrap();
				}
				this.folderNotesCache = null;
				this.scheduleRefresh();
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.index?.remove(file.path);
				this.folderNotesCache = null;
				this.scheduleRefresh();
			}),
		);
	}

	/** metadataCache 读取（禁全量遍历：只读目标文件的缓存） */
	private readFrontmatter(path: string): Record<string, unknown> | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return null;
		return this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
	}

	/** 合并密集事件：一次保存可能连发多个 changed */
	private scheduleRefresh(): void {
		const win = this.app.workspace.containerEl.ownerDocument.defaultView;
		if (win === null) {
			this.requestRefresh();
			return;
		}
		if (this.refreshTimer !== null) win.clearTimeout(this.refreshTimer);
		this.refreshTimer = win.setTimeout(() => {
			this.refreshTimer = null;
			this.requestRefresh();
		}, REFRESH_DEBOUNCE_MS);
	}

	// ────────────────────────────── DashboardHost ──────────────────────────────

	getProjects(): ProjectItem[] {
		return this.index?.getAll() ?? [];
	}

	getIssues(): Record<string, DataIssue[]> {
		return this.index?.getIssues() ?? {};
	}

	/**
	 * 文件夹 → 组内笔记（F3.3）。
	 * 只在按文件夹分组时才有意义，因此缓存整表并在 vault 结构变化时失效，
	 * 避免每次刷新都遍历全库（技能：不阻塞交互、缓存边界明确）。
	 */
	getFolderNotes(): Record<string, NoteLink[]> {
		if (this.folderNotesCache !== null) return this.folderNotesCache;
		const map: Record<string, NoteLink[]> = {};
		for (const file of this.app.vault.getMarkdownFiles()) {
			const folder = toFileInfo(file.path).folder;
			const bucket = map[folder];
			const link: NoteLink = { path: file.path, name: file.basename };
			if (bucket === undefined) {
				map[folder] = [link];
			} else {
				bucket.push(link);
			}
		}
		this.folderNotesCache = map;
		return map;
	}

	/** 只落盘设置（手动排序、导出选项这类不影响索引的改动走它，省掉一次全库重扫） */
	async persistSettings(): Promise<void> {
		await this.saveSettings();
	}

	/**
	 * 刷新所有已打开的 dashboard 视图。
	 * 用 `getLeavesOfType` 现场取，不保存全局 view 实例（技能：视图由工厂创建）。
	 */
	requestRefresh(): void {
		this.forEachDashboard((view) => view.refresh());
	}

	private forEachDashboard(action: (view: DashboardView) => void): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_DASHBOARD)) {
			const view = leaf.view;
			if (view instanceof DashboardView) {
				action(view);
			}
		}
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_PM_DASHBOARD);
		const leaf = existing.length > 0 ? existing[0] : workspace.getLeaf(true);
		if (leaf === null) return;
		await leaf.setViewState({ type: VIEW_TYPE_PM_DASHBOARD, active: true });
		await workspace.revealLeaf(leaf);
	}

	/**
	 * 让出主线程一帧（分批索引用），避免长任务阻塞 UI。
	 * 定时器挂在视图容器所属的 window 上，而不是全局 window：
	 * 多窗口（popout）场景下两个 window 的定时器是独立的，用错了会在错误的窗口里排队。
	 */
	private yieldToEventLoop(): Promise<void> {
		const win = this.app.workspace.containerEl.ownerDocument.defaultView;
		return new Promise((resolve) => {
			if (win === null) {
				resolve();
				return;
			}
			win.setTimeout(resolve, 0);
		});
	}
}
