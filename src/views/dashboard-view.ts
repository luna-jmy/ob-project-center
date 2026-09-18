import { ItemView, WorkspaceLeaf } from "obsidian";
import type ProjectMasterPlugin from "../main";

/** 视图类型 ID：pm- 前缀保证唯一（agent.md §2.1） */
export const VIEW_TYPE_PM_DASHBOARD = "pm-dashboard-view";

/**
 * Dashboard 主视图（SPEC §3/F5）。
 * Milestone 0：仅骨架——布局组装、甘特区、分组面板随后续里程碑按 TDD 落地。
 */
export class DashboardView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: ProjectMasterPlugin,
	) {
		super(leaf);
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

	async onOpen(): Promise<void> {
		// 根容器：pm- 前缀，所有样式限制在此作用域内（agent.md §2.1/§2.2）
		const root = this.contentEl.createDiv({ cls: "pm-dashboard-root" });
		root.createEl("h2", { text: "Project dashboard" });
		root.createEl("p", {
			text: "Scaffold ready. Gantt, filters and group panels arrive in upcoming milestones.",
		});
	}

	async onClose(): Promise<void> {
		// 释放视图内资源（甘特库 destroy 等在此收口）
		this.contentEl.empty();
	}
}
