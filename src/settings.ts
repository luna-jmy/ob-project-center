import { App, PluginSettingTab, Setting } from "obsidian";
import type ProjectMasterPlugin from "./main";

/**
 * 设置页（SPEC §5）。
 * Milestone 0：仅骨架与参数分组占位；完整四组参数 UI 随后续里程碑落地。
 */
export class ProjectMasterSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: ProjectMasterPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Project folders")
			.setDesc("Folders to scan for project notes (comma separated).")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.scanFolders.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.scanFolders = value
							.split(",")
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
						await this.plugin.saveSettings();
					}),
			);
	}
}
