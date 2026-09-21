import { App, ColorComponent, Modal, Setting, TextComponent } from "obsidian";
import { t } from "../i18n";
import { barColorPresets, isHexColor } from "../gantt/bar-colors";
import { isColorLike } from "../services/normalize";
import {
	EditorValues,
	editorValuesFromItem,
	FieldSuggestions,
	emptyEditorValues,
	parseDateInput,
	parseNumberInput,
	buildProjectPatch,
} from "../services/frontmatter-mapping";
import {
	priorityLabel,
	ProjectItem,
	ProjectMasterSettings,
	ProjectStatus,
	statusLabel,
} from "../types";
// 「已有值候选」字段（单值 datalist / 多值点选标签）与新建弹窗共用，见模块注释
import { addListFieldSetting, addTextFieldSetting } from "./suggestion-fields";

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
	/**
	 * 已有值候选（领域 / 目标 / 负责人 / 成员），用于下拉与点选标签。
	 * 由调用方从全部项目现算——弹窗自己不该去翻索引。
	 */
	getSuggestions(): FieldSuggestions;
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
	/** 进度输入框：状态改成「完成」时要能顺手把框里的值一起改掉（见 onOpen 里的防呆） */
	private progressText: TextComponent | null = null;
	private colorPicker: ColorComponent | null = null;
	private colorPresetsEl: HTMLElement | null = null;
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
		// 已有值候选：领域 / 目标 / 负责人 / 成员，来自库里已经写过的值
		const suggestions = this.deps.getSuggestions();

		new Setting(contentEl)
			.setName(t("状态"))
			.setDesc(t("对齐模板的中文标签 + 英文值"))
			.addDropdown((dropdown) => {
				for (const status of settings.statusOrder) {
					dropdown.addOption(status, `${statusLabel(status)}（${status}）`);
				}
				// 数据非法时 status 为 null，必须有一个可表达「未设置」的选项
				dropdown.addOption("", t("（未设置）"));
				dropdown.setValue(this.values.status ?? "");
				dropdown.onChange((value) => {
					const status = value === "" ? null : (value as ProjectStatus);
					this.values.status = status;
					/*
					 * 防呆（用户口径 2026-09-20）：一改成「完成」，进度直接填 100。
					 *
					 * 起因是实打实的脏数据：不少项目状态已经改成完成、progress 还停在 30 / 50，
					 * 甘特条上就成了「已完成却只推进一半」的怪样子（再加上半透明进度层，更像配色出错）。
					 *
					 * **只填不锁**：用户随后完全可以把它改成别的值再保存（例如实际只做到 80）。
					 * 反向不做（完成 → 执行中 不回滚进度）：那一步多半是顺手改的，
					 * 把他刚接受的 100 又抹掉反而添乱。
					 */
					if (status === "completed") {
						this.values.progress = 100;
						this.progressText?.setValue("100");
					}
				});
			});

		new Setting(contentEl).setName(t("优先级")).addDropdown((dropdown) => {
			for (const value of ["1", "2", "3", "4", "5"]) {
				dropdown.addOption(value, `${priorityLabel(value)}（${value}）`);
			}
			dropdown.addOption("", t("（未设置）"));
			dropdown.setValue(this.values.priority ?? "");
			dropdown.onChange((value) => {
				this.values.priority = value === "" ? null : value;
			});
		});

		this.addDateSetting(contentEl, t("开始日期"), this.values.startDate, (value) => {
			this.values.startDate = value;
		});
		this.addDateSetting(contentEl, t("截止日期"), this.values.dueDate, (value) => {
			this.values.dueDate = value;
		});
		this.addDateSetting(
			contentEl,
			t("实际完成日"),
			this.values.completionDate,
			(value) => {
				this.values.completionDate = value;
			},
		);

		new Setting(contentEl)
			.setName(t("进度"))
			.setDesc(t("0–100；留空表示未设置。状态改成「完成」时会自动填 100，可再手动改"))
			.addText((text) => {
				this.progressText = text;
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text.inputEl.max = "100";
				text.setValue(this.values.progress === null ? "" : String(this.values.progress));
				text.setPlaceholder(t("未设置"));
				text.onChange((value) => {
					this.values.progress = parseNumberInput(value, 0, 100);
				});
			});

		/*
		 * 领域是**单值**（用户口径 2026-09-21）：它是分组维度，多值会让分组失效——
		 * 分组只认一个值，其余值在分组里根本看不见。所以与「目标」同一套输入
		 * （可输入的下拉），不再走多值输入框 + 点选标签那一套。
		 */
		addTextFieldSetting(
			contentEl,
			t("领域"),
			this.values.area,
			(v) => {
				this.values.area = v;
			},
			{ desc: t("单个值；按领域分组与筛选都看这一个"), suggestions: suggestions.area },
		);
		addTextFieldSetting(
			contentEl,
			t("目标（objective）"),
			this.values.objective,
			(v) => {
				this.values.objective = v;
			},
			{ suggestions: suggestions.objective },
		);
		addTextFieldSetting(
			contentEl,
			t("项目负责人"),
			this.values.projectLeader,
			(v) => {
				this.values.projectLeader = v;
			},
			{ suggestions: suggestions.projectLeader },
		);
		addListFieldSetting(
			contentEl,
			t("项目成员"),
			this.values.projectMembers,
			(list) => {
				this.values.projectMembers = list;
			},
			{ suggestions: suggestions.projectMembers },
		);

		new Setting(contentEl)
			.setName(t("长期项目"))
			.setDesc(
				t("开启后豁免全部日期筛选，并且不上甘特图——只在面板里出现（没有确定的时间边界）"),
			)
			.addToggle((toggle) => {
				toggle.setValue(this.values.longTerm);
				toggle.onChange((value) => {
					this.values.longTerm = value;
				});
			});

		new Setting(contentEl)
			.setName(t("主项目"))
			.setDesc(t("同文件夹多个项目时，作为该文件夹的代表卡片"))
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

		/*
		 * 备注放**最底部**（用户口径 2026-09-21）：改状态只是它的用法之一，
		 * 也用来记决策、卡点、回顾——挤在状态下会给人"只在改状态时才填"的错觉。
		 * 多行文本域：备注通常不止一句。
		 */
		new Setting(contentEl)
			.setName(t("备注"))
			.setDesc(t("随手记状态变更、决策、卡点；存进 frontmatter 的备注字段。"))
			.addTextArea((area) => {
				area.setValue(this.values.remark ?? "");
				area.inputEl.rows = 4;
				area.inputEl.addClass("pm-modal__remark");
				area.onChange((value) => {
					const trimmed = value.trim();
					this.values.remark = trimmed.length === 0 ? null : trimmed;
				});
			});

		this.renderActions(contentEl);
	}

	private renderActions(host: HTMLElement): void {
		const actions = host.createDiv({ cls: "pm-modal__actions" });

		// Modal 不是 Component（没有 registerDomEvent）；这些节点随 onClose 一并销毁
		const save = actions.createEl("button", {
			cls: "mod-cta",
			text: t("保存"),
			attr: { type: "button" },
		});
		save.addEventListener("click", () => {
			void this.handleSave();
		});

		const cancel = actions.createEl("button", {
			text: t("取消"),
			attr: { type: "button" },
		});
		cancel.addEventListener("click", () => this.close());

		const open = actions.createEl("button", {
			text: t("打开笔记"),
			attr: { type: "button" },
		});
		open.addEventListener("click", () => {
			this.deps.openNote(this.path);
			this.close();
		});

		// F4.4：只移除 type 字段，笔记本体保留；需要二次确认
		const clear = actions.createEl("button", {
			cls: "mod-warning",
			text: t("清除项目标记"),
			attr: {
				type: "button",
				title: t("仅从插件管理中移除（删除 type 字段），不会删除笔记"),
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
			button.setText(t("再点一次确认清除"));
			button.addClass("pm-confirm");
			return;
		}
		await this.deps.clearProjectType(this.path);
		this.close();
		this.deps.onDone();
	}

	/**
	 * 甘特条颜色（用户口径 2026-09-20：预设色块优先，不再让人一律去调 RGB）。
	 *
	 * 三件控件各司其职：
	 * - **预设色块**：一键选主题色，这是最常用的路径；
	 * - 文本框：吃任意 CSS 颜色（#hex / 颜色名 / var()），留给自定义；
	 * - 取色器：只认 `#rrggbb`，留给「就要这个具体色值」的场景。
	 *
	 * 三者都走 `applyColor()` 这一个写入口，保证互相同步。无法识别的写法**不拦**，
	 * 只在下面提示一句——真正卡住渲染的判定统一由 normalize 层负责，并在「数据问题」区回报。
	 */
	private renderColorSetting(host: HTMLElement): void {
		const setting = new Setting(host)
			.setName(t("甘特条颜色"))
			.setDesc(
				t("点色块选主题色；也可直接填 #ff8800、var(--color-blue)、颜色名。留空则按项目状态用默认色。"),
			);

		setting.addText((text) => {
			this.colorText = text;
			text.setPlaceholder(t("默认（按状态）"));
			text.setValue(this.values.color ?? "");
			text.onChange((value) => {
				const trimmed = value.trim();
				// 不回写文本框：正在输入时同步会把光标顶到末尾、中文输入法候选框也会丢
				this.applyColor(trimmed.length === 0 ? null : trimmed, false);
			});
		});

		setting.addColorPicker((picker) => {
			this.colorPicker = picker;
			picker.setValue(toHexOrNeutral(this.values.color));
			picker.onChange((value) => this.applyColor(value, true));
		});

		// 预设色块独占一行：塞进 Setting 右上角的控件区会把那一行挤成一团
		const presets = host.createDiv({ cls: "pm-color-presets" });
		this.colorPresetsEl = presets;
		for (const preset of barColorPresets()) {
			const swatch = presets.createEl("button", {
				cls: `pm-color-swatch${preset.value === null ? " pm-color-swatch--default" : ""}`,
				attr: { type: "button", title: preset.label, "aria-label": preset.label },
			});
			// 用 data-* 记住它代表哪个值：高亮时按值比对，不必再建一张映射表
			swatch.dataset.color = preset.value ?? "";
			/*
			 * 颜色直接写到元素上，**不再中转自定义属性**。
			 *
			 * 原先写的是 `--pm-swatch-color: var(--color-red)`，再由样式表
			 * `background: var(--pm-swatch-color, transparent)` 取用。这种「变量套变量」
			 * 在弹窗里解析不出颜色，8 个色块全成了空心方框。
			 * 同一张界面上的单层写法都是好的（「清除项目标记」的红底、斜纹色块的渐变色），
			 * 所以问题出在中转这一步，不是颜色值本身。
			 */
			if (preset.value !== null) swatch.style.backgroundColor = preset.value;
			swatch.addEventListener("click", () => this.applyColor(preset.value, true));
		}
		this.updateColorSwatches();

		this.colorHintEl = host.createDiv({ cls: "pm-modal__hint pm-modal__hint--color" });
		this.updateColorHint();
	}

	/**
	 * 颜色的唯一写入口。
	 * @param syncText 是否把值回写到文本框——从文本框自己触发的改动必须传 false（否则光标乱跳）
	 */
	private applyColor(value: string | null, syncText: boolean): void {
		this.values.color = value;
		if (syncText) this.colorText?.setValue(value ?? "");
		// 取色器没有「不指定」状态：留空时回到中性色作为起点，它本身不写数据
		if (value === null) this.colorPicker?.setValue(NEUTRAL_HEX);
		else if (isHexColor(value)) this.colorPicker?.setValue(value);
		this.updateColorSwatches();
		this.updateColorHint();
	}

	private updateColorSwatches(): void {
		const host = this.colorPresetsEl;
		if (host === null) return;
		const current = this.values.color ?? "";
		for (const swatch of Array.from(host.querySelectorAll<HTMLElement>(".pm-color-swatch"))) {
			swatch.classList.toggle("is-active", (swatch.dataset.color ?? "") === current);
		}
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
				: t("Mermaid 导出不支持逐任务配色，该颜色只影响自绘甘特图。"),
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

	private displayName(): string {
		const item = this.deps.getItem(this.path);
		return item !== null ? item.file.name : this.path;
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** 取色器的中性起点色（既不是「默认」也不属于任何预设） */
const NEUTRAL_HEX = "#888888";

/** 取色器只吃 hex：非 hex 的颜色（var()、颜色名）用一个中性色作为起点 */
function toHexOrNeutral(color: string | null): string {
	return color !== null && isHexColor(color) ? color : NEUTRAL_HEX;
}
