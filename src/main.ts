import { Plugin, WorkspaceLeaf } from "obsidian";
import { DashboardView, VIEW_TYPE_PM_DASHBOARD } from "./views/dashboard-view";
import { ProjectMasterSettingTab } from "./settings";
import { DEFAULT_SETTINGS, ProjectMasterSettings } from "./types";

/**
 * Project Master — 薄装配层（SPEC §3）。
 * onload 只做注册与轻量初始化；重活全部延迟到 onLayoutReady 之后（技能 compatibility.md）。
 */
export default class ProjectMasterPlugin extends Plugin {
	settings: ProjectMasterSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_PM_DASHBOARD,
			(leaf: WorkspaceLeaf) => new DashboardView(leaf, this),
		);

		// 不注册默认快捷键（agent.md via 技能）
		this.addRibbonIcon("layout-dashboard", "Open project dashboard", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-dashboard",
			name: "Open project dashboard",
			callback: () => {
				void this.activateView();
			},
		});

		this.addSettingTab(new ProjectMasterSettingTab(this.app, this));

		// 初始索引等重活在这里分批进行（后续里程碑）
		this.app.workspace.onLayoutReady(() => {
			// milestone: project-index bootstrapping
		});
	}

	onunload(): void {
		// 按技能要求：不在 onunload 中 detach leaves，避免破坏布局恢复
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<ProjectMasterSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		// 配置目录不硬编码 .obsidian，运行时以 Vault#configDir 为准
		this.settings.excludedFolders = [
			...new Set([this.app.vault.configDir, ...this.settings.excludedFolders]),
		];
		// TODO(milestone): version 迁移函数在此调用，迁移需可重复执行且失败保留原数据
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_PM_DASHBOARD);
		const leaf =
			existing.length > 0
				? existing[0]
				: workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE_PM_DASHBOARD, active: true });
		await workspace.revealLeaf(leaf);
	}
}
