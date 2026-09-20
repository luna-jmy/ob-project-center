import { App, Modal, Setting } from "obsidian";
import {
	EditorValues,
	buildNewProjectPatch,
	emptyEditorValues,
	parseDateInput,
	parseListInput,
} from "../services/frontmatter-mapping";
import { sanitizeNoteName } from "../services/project-service";
import {
	PRIORITY_LABELS,
	ProjectMasterSettings,
	ProjectStatus,
	STATUS_LABELS,
} from "../types";

/**
 * 新建项目 Modal（SPEC §4 F4.1 + 用户口径 2026-09-18）。
 *
 * 两种形态（这是数据模型的直接体现）：
 * - **带文件夹（正常项目）** → `<上级目录>/<项目名>/<项目名>.md`。
 *   项目资料/笔记今后放进该文件夹的子文件夹里；可勾选顺带创建「资料」子文件夹。
 * - **快速项目** → `<上级目录>/<项目名>.md`，直接落在扫描目录根层，
 *   因而自动进入左侧「快速项目（根目录）」分区（F3.1）。
 *
 * 实现口径：先创建笔记、再经 processFrontMatter 写字段（不手搓 YAML）。
 * Templater 模板联动是 SPEC 标注的增强项，v1 未实现——字段体系与模板一致。
 */

export type NewProjectShape = "folder" | "quick";

export interface NewProjectModalDeps {
	getSettings(): ProjectMasterSettings;
	/** 创建笔记并写回字段，返回新笔记路径 */
	createProject(input: {
		folderPath: string;
		title: string;
		patch: Record<string, unknown>;
		extraFolders?: string[];
	}): Promise<string>;
	openNote(path: string): void;
	onDone(): void;
}

export class NewProjectModal extends Modal {
	private title = "";
	private shape: NewProjectShape = "folder";
	private parentFolder: string;
	private withMaterials = true;
	private values: EditorValues = emptyEditorValues();
	private errorEl: HTMLElement | null = null;
	private materialsSetting: Setting | null = null;
	private locationHintEl: HTMLElement | null = null;
	private busy = false;

	constructor(app: App, private readonly deps: NewProjectModalDeps) {
		super(app);
		const settings = deps.getSettings();
		this.parentFolder = settings.scanFolders[0] ?? "";
		this.values.status = "inbox";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pm-modal");
		this.titleEl.setText("新建项目");

		const settings = this.deps.getSettings();

		new Setting(contentEl)
			.setName("项目名称")
			.setDesc("非法字符会被替换为连字符")
			.addText((text) => {
				text.setPlaceholder("例如：官网改版");
				text.onChange((value) => {
					this.title = value;
					this.updateLocationHint();
				});
				text.inputEl.focus();
			});

		new Setting(contentEl)
			.setName("项目形态")
			.setDesc("带文件夹的项目把资料/笔记收在自己的子文件夹里；快速项目只放一份文档。")
			.addDropdown((dropdown) => {
				dropdown.addOption("folder", "带文件夹（正常项目）");
				dropdown.addOption("quick", "不带文件夹（快速项目）");
				dropdown.setValue(this.shape);
				dropdown.onChange((value) => {
					this.shape = value === "quick" ? "quick" : "folder";
					this.syncShape();
				});
			});

		new Setting(contentEl)
			.setName("上级目录")
			.setDesc("默认取设置里的第一个项目扫描目录")
			.addText((text) => {
				text.setValue(this.parentFolder);
				text.onChange((value) => {
					this.parentFolder = value;
					this.updateLocationHint();
				});
			});

		this.materialsSetting = new Setting(contentEl)
			.setName("同时创建资料子文件夹")
			.setDesc(`在项目文件夹下预建「${settings.materialsFolderName}」，用于放该项目的资料/笔记。`)
			.addToggle((toggle) => {
				toggle.setValue(this.withMaterials);
				toggle.onChange((value) => {
					this.withMaterials = value;
				});
			});

		this.locationHintEl = contentEl.createDiv({ cls: "pm-modal__hint" });

		new Setting(contentEl).setName("状态").addDropdown((dropdown) => {
			for (const status of settings.statusOrder) {
				dropdown.addOption(status, `${STATUS_LABELS[status]}（${status}）`);
			}
			dropdown.setValue(this.values.status ?? "inbox");
			dropdown.onChange((value) => {
				this.values.status = value === "" ? null : (value as ProjectStatus);
			});
		});

		new Setting(contentEl).setName("优先级").addDropdown((dropdown) => {
			for (const value of ["1", "2", "3", "4", "5"]) {
				dropdown.addOption(value, `${PRIORITY_LABELS[value] ?? ""}（${value}）`);
			}
			dropdown.addOption("", "（未设置）");
			dropdown.setValue("");
			dropdown.onChange((value) => {
				this.values.priority = value === "" ? null : value;
			});
		});

		new Setting(contentEl).setName("开始日期").addText((text) => {
			text.inputEl.type = "date";
			text.onChange((value) => {
				this.values.startDate = parseDateInput(value);
			});
		});

		new Setting(contentEl).setName("截止日期").addText((text) => {
			text.inputEl.type = "date";
			text.onChange((value) => {
				this.values.dueDate = parseDateInput(value);
			});
		});

		new Setting(contentEl)
			.setName("目标（objective）")
			.setDesc("甘特图按它分节")
			.addText((text) => {
				text.onChange((value) => {
					const trimmed = value.trim();
					this.values.objective = trimmed.length === 0 ? null : trimmed;
				});
			});

		new Setting(contentEl)
			.setName("领域")
			.setDesc("多个值用逗号分隔")
			.addText((text) => {
				text.onChange((value) => {
					this.values.area = parseListInput(value);
				});
			});

		this.errorEl = contentEl.createDiv({ cls: "pm-modal__error" });

		// Modal 不是 Component；这些节点随 onClose 的 contentEl.empty() 一并销毁
		const actions = contentEl.createDiv({ cls: "pm-modal__actions" });
		const create = actions.createEl("button", {
			cls: "mod-cta",
			text: "创建",
			attr: { type: "button" },
		});
		create.addEventListener("click", () => {
			void this.submit(false);
		});

		const createAndOpen = actions.createEl("button", {
			text: "创建并打开",
			attr: { type: "button" },
		});
		createAndOpen.addEventListener("click", () => {
			void this.submit(true);
		});

		const cancel = actions.createEl("button", {
			text: "取消",
			attr: { type: "button" },
		});
		cancel.addEventListener("click", () => this.close());

		this.syncShape();
	}

	/** 只有「带文件夹」形态才谈得上资料子文件夹 */
	private syncShape(): void {
		const isFolderShape = this.shape === "folder";
		this.materialsSetting?.setDisabled(!isFolderShape);
		this.materialsSetting?.settingEl.toggleClass("is-disabled", !isFolderShape);
		this.updateLocationHint();
	}

	private updateLocationHint(): void {
		this.locationHintEl?.setText(this.targetPath().hint);
	}

	/** 目标路径（纯推导，创建前给用户看清楚东西会落在哪） */
	targetPath(): { folderPath: string; extraFolders: string[]; hint: string } {
		const parent = this.parentFolder.trim().replace(/^\/+|\/+$/g, "");
		const name = this.sanitizeForDisplay();
		if (this.shape === "quick") {
			const folderPath = parent;
			return {
				folderPath,
				extraFolders: [],
				hint: `将创建：${joinPath(folderPath, `${name}.md`)}（快速项目，直接放根层）`,
			};
		}
		const folderPath = joinPath(parent, name);
		const settings = this.deps.getSettings();
		const extraFolders =
			this.withMaterials && settings.materialsFolderName.trim().length > 0
				? [joinPath(folderPath, settings.materialsFolderName.trim())]
				: [];
		const extras = extraFolders.length > 0 ? `，并预建「${settings.materialsFolderName}」子文件夹` : "";
		return {
			folderPath,
			extraFolders,
			hint: `将创建：${joinPath(folderPath, `${name}.md`)}${extras}`,
		};
	}

	/** 展示用名：与真正落盘时的清洗保持一致，避免提示与实际不符 */
	private sanitizeForDisplay(): string {
		const raw = this.title.trim();
		return raw.length === 0 ? "新项目" : sanitizeNoteName(raw);
	}

	private async submit(openAfter: boolean): Promise<void> {
		if (this.busy) return;
		if (this.title.trim().length === 0) {
			this.showError("请填写项目名称。");
			return;
		}
		this.busy = true;
		this.showError("");
		try {
			const settings = this.deps.getSettings();
			const target = this.targetPath();
			const path = await this.deps.createProject({
				folderPath: target.folderPath,
				title: this.title,
				patch: buildNewProjectPatch(this.values, settings.fieldMapping),
				extraFolders: target.extraFolders,
			});
			if (openAfter) this.deps.openNote(path);
			this.close();
			this.deps.onDone();
		} catch (error) {
			this.busy = false;
			this.showError(`创建失败：${describeError(error)}`);
		}
	}

	private showError(message: string): void {
		this.errorEl?.setText(message);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function joinPath(parent: string, child: string): string {
	if (parent.length === 0) return child;
	return `${parent}/${child}`;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
