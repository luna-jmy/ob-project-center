import { App, ColorComponent, Modal, Setting, TextComponent } from "obsidian";
import { isColorLike } from "../services/normalize";
import {
	EditorValues,
	editorValuesFromItem,
	formatListInput,
	emptyEditorValues,
	parseDateInput,
	parseListInput,
	parseNumberInput,
	buildProjectPatch,
} from "../services/frontmatter-mapping";
import {
	PRIORITY_LABELS,
	ProjectItem,
	ProjectMasterSettings,
	ProjectStatus,
	STATUS_LABELS,
} from "../types";

/**
 * 项目编辑 Modal（SPEC §4 F4.2/F4.3/F4.4）。
 *
 * 约束：
 * - 字段名一律经映射层（buildProjectPatch），UI 不知道任何物理字段名；
 * - 写回只在「保存」时发生一次，走 processFrontMatter（不自己读写文件）；
 * - 「清除项目标记」= 只删 `type` 字段让笔记脱离管理，**不删笔记**，且需要二次确认（F4.4）。
 *
 * Modal 不直接持有插件实例：依赖以接口注入，避免 modals → main 的循环引用，
 * 也让这个文件不依赖插件的整体状态。
 */

export interface EditorModalDeps {
	getSettings(): ProjectMasterSettings;
	getItem(path: string): ProjectItem | null;
	/** 写回 patch（null 值 = 删除字段） */
	save(path: string, patch: Record<string, unknown>): Promise<void>;
	/** F4.4：清除 type 字段，使笔记脱离插件管理 */
	clearProjectType(path: string): Promise<void>;
	openNote(path: string): void;
	/** 写回完成后通知视图刷新 */
	onDone(): void;
}

export class ProjectEditorModal extends Modal {
	private values: EditorValues;
	private confirmingClear = false;
	private saving = false;
	private colorText: TextComponent | null = null;
	private colorPicker: ColorComponent | null = null;
	private colorHintEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly path: string,
		private readonly deps: EditorModalDeps,
	) {
		super(app);
		const item = deps.getItem(path);
		this.values = item !== null ? editorValuesFromItem(item) : emptyEditorValues();
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pm-modal");
		this.titleEl.setText(`编辑项目 · ${this.displayName()}`);

		const settings = this.deps.getSettings();
		const mapping = settings.fieldMapping;

		new Setting(contentEl)
			.setName("状态")
			.setDesc("对齐模板的中文标签 + 英文值")
			.addDropdown((dropdown) => {
				for (const status of settings.statusOrder) {
					dropdown.addOption(status, `${STATUS_LABELS[status]}（${status}）`);
				}
				// 数据非法时 status 为 null，必须有一个可表达「未设置」的选项
				dropdown.addOption("", "（未设置）");
				dropdown.setValue(this.values.status ?? "");
				dropdown.onChange((value) => {
					this.values.status =
						value === "" ? null : (value as ProjectStatus);
				});
			});

		new Setting(contentEl).setName("优先级").addDropdown((dropdown) => {
			for (const value of ["1", "2", "3", "4", "5"]) {
				dropdown.addOption(value, `${PRIORITY_LABELS[value] ?? ""}（${value}）`);
			}
			dropdown.addOption("", "（未设置）");
			dropdown.setValue(this.values.priority ?? "");
			dropdown.onChange((value) => {
				this.values.priority = value === "" ? null : value;
			});
		});

		this.addDateSetting(contentEl, "开始日期", this.values.startDate, (value) => {
			this.values.startDate = value;
		});
		this.addDateSetting(contentEl, "截止日期", this.values.dueDate, (value) => {
			this.values.dueDate = value;
		});
		this.addDateSetting(
			contentEl,
			"实际完成日",
			this.values.completionDate,
			(value) => {
				this.values.completionDate = value;
			},
		);

		new Setting(contentEl)
			.setName("进度")
			.setDesc("0–100；留空表示未设置")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text.inputEl.max = "100";
				text.setValue(this.values.progress === null ? "" : String(this.values.progress));
				text.setPlaceholder("未设置");
				text.onChange((value) => {
					this.values.progress = parseNumberInput(value, 0, 100);
				});
			});

		this.addListSetting(contentEl, "领域", this.values.area, (list) => {
			this.values.area = list;
		});
		this.addTextSetting(contentEl, "目标（objective）", this.values.objective, (v) => {
			this.values.objective = v;
		});
		this.addTextSetting(contentEl, "项目负责人", this.values.projectLeader, (v) => {
			this.values.projectLeader = v;
		});
		this.addListSetting(contentEl, "项目成员", this.values.projectMembers, (list) => {
			this.values.projectMembers = list;
		});

		new Setting(contentEl)
			.setName("长期项目")
			.setDesc("开启后豁免日期区间筛选（现有规则）")
			.addToggle((toggle) => {
				toggle.setValue(this.values.longTerm);
				toggle.onChange((value) => {
					this.values.longTerm = value;
				});
			});

		new Setting(contentEl)
			.setName("主项目")
			.setDesc("同文件夹多个项目时，作为该文件夹的代表卡片")
			.addToggle((toggle) => {
				toggle.setValue(this.values.mainProject);
				toggle.onChange((value) => {
					this.values.mainProject = value;
				});
			});

		this.renderColorSetting(contentEl);

		// 物理字段名只在这里作为「提示」出现，方便用户对照模板自查
		contentEl.createDiv({
			cls: "pm-modal__hint",
			text: `写回字段：${mapping.status} / ${mapping.priority} / ${mapping.startDate} / ${mapping.dueDate} / ${mapping.area} / ${mapping.color} …（可在设置中重映射）`,
		});

		this.renderActions(contentEl);
	}

	private renderActions(host: HTMLElement): void {
		const actions = host.createDiv({ cls: "pm-modal__actions" });

		// Modal 不是 Component（没有 registerDomEvent）；这些节点随 onClose 一并销毁
		const save = actions.createEl("button", {
			cls: "mod-cta",
			text: "保存",
			attr: { type: "button" },
		});
		save.addEventListener("click", () => {
			void this.handleSave();
		});

		const cancel = actions.createEl("button", {
			text: "取消",
			attr: { type: "button" },
		});
		cancel.addEventListener("click", () => this.close());

		const open = actions.createEl("button", {
			text: "打开笔记",
			attr: { type: "button" },
		});
		open.addEventListener("click", () => {
			this.deps.openNote(this.path);
			this.close();
		});

		// F4.4：只移除 type 字段，笔记本体保留；需要二次确认
		const clear = actions.createEl("button", {
			cls: "mod-warning",
			text: "清除项目标记",
			attr: {
				type: "button",
				title: "仅从插件管理中移除（删除 type 字段），不会删除笔记",
			},
		});
		clear.addEventListener("click", () => {
			void this.handleClear(clear);
		});
	}

	private async handleSave(): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		try {
			const settings = this.deps.getSettings();
			await this.deps.save(this.path, buildProjectPatch(this.values, settings.fieldMapping));
			this.close();
			this.deps.onDone();
		} finally {
			this.saving = false;
		}
	}

	/** 二次确认走「按钮变形」而不是嵌套 Modal，避免上下文丢失 */
	private async handleClear(button: HTMLButtonElement): Promise<void> {
		if (!this.confirmingClear) {
			this.confirmingClear = true;
			button.setText("再点一次确认清除");
			button.addClass("pm-confirm");
			return;
		}
		await this.deps.clearProjectType(this.path);
		this.close();
		this.deps.onDone();
	}

	/**
	 * 甘特条颜色：文本框（吃任意 CSS 颜色，含 var(--x) 跟随主题）+ 取色器（只出 hex）。
	 * 两者互相同步；无法识别的写法**不拦**，只在下面提示一句——
	 * 真正卡住渲染的判定统一由 normalize 层负责，并在「数据问题」区回报。
	 */
	private renderColorSetting(host: HTMLElement): void {
		const setting = new Setting(host)
			.setName("甘特条颜色")
			.setDesc("可填 #ff8800、var(--color-blue)、颜色名。留空则按项目状态用默认色。");

		setting.addText((text) => {
			this.colorText = text;
			text.setPlaceholder("默认（按状态）");
			text.setValue(this.values.color ?? "");
			text.onChange((value) => {
				const trimmed = value.trim();
				this.values.color = trimmed.length === 0 ? null : trimmed;
				if (trimmed.startsWith("#")) this.colorPicker?.setValue(trimmed);
				this.updateColorHint();
			});
		});

		setting.addColorPicker((picker) => {
			this.colorPicker = picker;
			picker.setValue(toHexOrNeutral(this.values.color));
			picker.onChange((value) => {
				this.values.color = value;
				this.colorText?.setValue(value);
				this.updateColorHint();
			});
		});

		this.colorHintEl = host.createDiv({ cls: "pm-modal__hint pm-modal__hint--color" });
		this.updateColorHint();
	}

	private updateColorHint(): void {
		const hint = this.colorHintEl;
		if (hint === null) return;
		const color = this.values.color;
		if (color !== null && !isColorLike(color)) {
			hint.setText(`⚠️「${color}」不是可识别的颜色，甘特图会退回默认色。`);
			hint.addClass("pm-modal__hint--warning");
			return;
		}
		hint.removeClass("pm-modal__hint--warning");
		hint.setText(
			color === null
				? ""
				: "Mermaid 导出不支持逐任务配色，该颜色只影响自绘甘特图。",
		);
	}

	private addDateSetting(
		host: HTMLElement,
		name: string,
		initial: string | null,
		assign: (value: string | null) => void,
	): void {
		new Setting(host).setName(name).addText((text) => {
			text.inputEl.type = "date";
			text.setValue(initial ?? "");
			text.onChange((value) => {
				assign(parseDateInput(value));
			});
		});
	}

	private addTextSetting(
		host: HTMLElement,
		name: string,
		initial: string | null,
		assign: (value: string | null) => void,
	): void {
		new Setting(host).setName(name).addText((text) => {
			text.setValue(initial ?? "");
			text.onChange((value) => {
				const trimmed = value.trim();
				assign(trimmed.length === 0 ? null : trimmed);
			});
		});
	}

	private addListSetting(
		host: HTMLElement,
		name: string,
		initial: string[],
		assign: (value: string[]) => void,
	): void {
		new Setting(host)
			.setName(name)
			.setDesc("多个值用逗号分隔")
			.addText((text) => {
				text.setValue(formatListInput(initial));
				text.onChange((value) => {
					assign(parseListInput(value));
				});
			});
	}

	private displayName(): string {
		const item = this.deps.getItem(this.path);
		return item !== null ? item.file.name : this.path;
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** 取色器只吃 hex：非 hex 的颜色（var()、颜色名）用一个中性色作为起点 */
function toHexOrNeutral(color: string | null): string {
	return color !== null && /^#[0-9a-f]{6}$/i.test(color) ? color : "#888888";
}
