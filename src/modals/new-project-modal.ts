import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";
import {
	EditorValues,
	buildNewProjectPatch,
	emptyEditorValues,
	FieldSuggestions,
	parseDateInput,
} from "../services/frontmatter-mapping";
import {
	quickProjectFolder,
	resolveParentFolder,
	sanitizeNoteName,
} from "../services/project-service";
import {
	priorityLabel,
	ProjectMasterSettings,
	ProjectStatus,
	statusLabel,
} from "../types";
// 目标 / 领域的输入方式与编辑弹窗共用（可输入的下拉：能选已有的，也能直接打新的）
import { addTextFieldSetting } from "./suggestion-fields";

/**
 * 新建项目 Modal（SPEC §4 F4.1 + 用户口径 2026-09-18 / 2026-09-20）。
 *
 * 两种形态（这是数据模型的直接体现）：
 * - **带文件夹（正常项目）** → `<上级目录>/<项目名>/<项目名>.md`。
 *   项目资料/笔记今后放进该文件夹的子文件夹里；可勾选顺带创建「资料」子文件夹。
 * - **快速项目** → `<上级目录>/<快速项目标记>/<项目名>.md`，落在共用的快速项目文件夹里
 *   （没有就现建），因而进入左侧「快速项目」分区（F3.1）。落点规则见
 *   `quickProjectFolder()`——与判定快速项目的 `isQuickProject()` 是同一口径的两半。
 *   标记留空时（合法配置）就直接放在上级目录里。
 *
 * 上级目录 = 设置里的扫描目录（下拉选，多目录时不让人重打一遍）+ 可选子文件夹
 * （留空 = 直接放在扫描目录下）。
 *
 * 模板联动（用户口径 2026-09-20）：设置里填了模板就用模板——正文整篇用它的，
 * 只补模板里缺的 frontmatter 字段；模板里的 Templater 命令交给 Templater 执行。
 * 留空则与既有行为一致。
 *
 * 实现口径：先创建笔记、再经 processFrontMatter 写字段（不手搓 YAML）。
 */

export type NewProjectShape = "folder" | "quick";

export interface NewProjectModalDeps {
	getSettings(): ProjectMasterSettings;
	/**
	 * 已有值候选（领域 / 目标）：与编辑弹窗同一套，由调用方从全部项目现算。
	 * 弹窗自己不该去翻索引（同 EditorModalDeps 的口径）。
	 */
	getSuggestions(): FieldSuggestions;
	/** 创建笔记并写回字段，返回新笔记路径 */
	createProject(input: {
		folderPath: string;
		title: string;
		patch: Record<string, unknown>;
		extraFolders?: string[];
		/** 模板笔记路径；空串 = 不用模板（见 project-service 的 createProject） */
		templatePath?: string;
	}): Promise<string>;
	openNote(path: string): void;
	onDone(): void;
}

export class NewProjectModal extends Modal {
	private title = "";
	private shape: NewProjectShape = "folder";
	/** 下拉选中的扫描目录（设置里已配过的那几个之一） */
	private scanFolder: string;
	/** 可选子文件夹（相对扫描目录，多级用 / 分隔）；留空 = 直接放在扫描目录下 */
	private subFolder = "";
	private withMaterials = true;
	private values: EditorValues = emptyEditorValues();
	private errorEl: HTMLElement | null = null;
	private materialsSetting: Setting | null = null;
	private locationHintEl: HTMLElement | null = null;
	private busy = false;

	constructor(app: App, private readonly deps: NewProjectModalDeps) {
		super(app);
		const settings = deps.getSettings();
		this.scanFolder = settings.scanFolders[0] ?? "";
		this.values.status = "inbox";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pm-modal");
		this.titleEl.setText(t("新建项目"));

		const settings = this.deps.getSettings();
		// 已有值候选现算（每次打开弹窗一次）：索引一变，候选项就是最新的
		const suggestions = this.deps.getSuggestions();

		new Setting(contentEl)
			.setName(t("项目名称"))
			.setDesc(t("非法字符会被替换为连字符"))
			.addText((text) => {
				text.setPlaceholder(t("例如：官网改版"));
				text.onChange((value) => {
					this.title = value;
					this.updateLocationHint();
				});
				text.inputEl.focus();
			});

		new Setting(contentEl)
			.setName(t("项目形态"))
			.setDesc(
				t("带文件夹的项目把资料/笔记收在自己的子文件夹里；快速项目只放一份文档。"),
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("folder", t("带文件夹（正常项目）"));
				dropdown.addOption("quick", t("不带文件夹（快速项目）"));
				dropdown.setValue(this.shape);
				dropdown.onChange((value) => {
					this.shape = value === "quick" ? "quick" : "folder";
					this.syncShape();
				});
			});

		/*
		 * 上级目录 = 扫描目录（下拉）+ 子文件夹（可选）。
		 *
		 * 扫描目录在设置里已经写过，不该让用户再手打一遍全路径（用户口径 2026-09-20）；
		 * 子文件夹单独一格是为了保留「项目放进中间层目录」的用法
		 * （如 `100 Projects/2026工作项目`），而不是把两者挤进一个输入框。
		 */
		const scanFolders = settings.scanFolders;
		const parentSetting = new Setting(contentEl).setName(t("上级目录"));
		if (scanFolders.length === 0) {
			// 一个扫描目录都没配（用户清空过设置）：下拉没有可选项，退回手输
			parentSetting
				.setDesc(
					t("设置里尚未配置项目扫描目录，请手输创建位置（建议先去设置里补上）"),
				)
				.addText((text) => {
					text.setValue(this.scanFolder);
					text.onChange((value) => {
						this.scanFolder = value;
						this.updateLocationHint();
					});
				});
		} else {
			parentSetting
				.setDesc(
					scanFolders.length > 1
						? t("从设置里的项目扫描目录中选一个")
						: t("取设置里的项目扫描目录"),
				)
				.addDropdown((dropdown) => {
					for (const folder of scanFolders) {
						dropdown.addOption(folder, folder);
					}
					dropdown.setValue(this.scanFolder);
					dropdown.onChange((value) => {
						this.scanFolder = value;
						this.updateLocationHint();
					});
				});
		}

		new Setting(contentEl)
			.setName(t("子文件夹（可选）"))
			.setDesc(t("多级用 / 分隔，例如 2026工作项目；留空 = 直接放在上面的扫描目录下。"))
			.addText((text) => {
				text.setPlaceholder(t("留空 = 放在扫描目录下"));
				text.onChange((value) => {
					this.subFolder = value;
					this.updateLocationHint();
				});
			});

		/*
		 * 资料子文件夹留空是合法配置（资料与项目文档同目录）：这时开关没有意义，
		 * 文案还会印出一个空书名号。留空时禁用并说明，而不是假装能建出来。
		 */
		const materialsFolder = settings.materialsFolderName.trim();
		this.materialsSetting = new Setting(contentEl)
			.setName(t("同时创建资料子文件夹"))
			.setDesc(
				materialsFolder.length === 0
					? t("未设资料子文件夹名（资料与项目文档放同一个文件夹），不会预建子文件夹。")
					: `在项目文件夹下预建「${materialsFolder}」，用于放该项目的资料/笔记。`,
			)
			.addToggle((toggle) => {
				toggle.setValue(this.withMaterials);
				toggle.onChange((value) => {
					this.withMaterials = value;
				});
			});

		this.locationHintEl = contentEl.createDiv({ cls: "pm-modal__hint" });

		new Setting(contentEl).setName(t("状态")).addDropdown((dropdown) => {
			for (const status of settings.statusOrder) {
				dropdown.addOption(status, `${statusLabel(status)}（${status}）`);
			}
			dropdown.setValue(this.values.status ?? "inbox");
			dropdown.onChange((value) => {
				this.values.status = value === "" ? null : (value as ProjectStatus);
			});
		});

		new Setting(contentEl).setName(t("优先级")).addDropdown((dropdown) => {
			for (const value of ["1", "2", "3", "4", "5"]) {
				dropdown.addOption(value, `${priorityLabel(value)}（${value}）`);
			}
			dropdown.addOption("", t("（未设置）"));
			dropdown.setValue("");
			dropdown.onChange((value) => {
				this.values.priority = value === "" ? null : value;
			});
		});

		new Setting(contentEl).setName(t("开始日期")).addText((text) => {
			text.inputEl.type = "date";
			text.onChange((value) => {
				this.values.startDate = parseDateInput(value);
			});
		});

		new Setting(contentEl).setName(t("截止日期")).addText((text) => {
			text.inputEl.type = "date";
			text.onChange((value) => {
				this.values.dueDate = parseDateInput(value);
			});
		});

		/*
		 * 目标 / 领域与编辑弹窗共用同一套字段（用户口径 2026-09-21）：单值走可输入的
		 * 下拉（datalist）、多值走点选标签，候选值都来自库里已经写过的值。
		 *
		 * 放在新建这一步才有意义：这恰恰是最容易手打出「市场部」这种变体的时刻，
		 * 而脏值一旦写进去，分组与筛选就已经裂成两拨了——等保存完再回编辑界面去选，
		 * 等于事后补救。
		 */
		addTextFieldSetting(
			contentEl,
			t("目标（objective）"),
			this.values.objective,
			(v) => {
				this.values.objective = v;
			},
			{ desc: t("甘特图按它分节"), suggestions: suggestions.objective },
		);

		// 领域是单值（它是分组维度，多值会让分组失效），与「目标」同一套输入
		addTextFieldSetting(
			contentEl,
			t("领域"),
			this.values.area,
			(v) => {
				this.values.area = v;
			},
			{ desc: t("单个值；按领域分组与筛选都看这一个"), suggestions: suggestions.area },
		);

		this.errorEl = contentEl.createDiv({ cls: "pm-modal__error" });

		// Modal 不是 Component；这些节点随 onClose 的 contentEl.empty() 一并销毁
		const actions = contentEl.createDiv({ cls: "pm-modal__actions" });
		const create = actions.createEl("button", {
			cls: "mod-cta",
			text: t("创建"),
			attr: { type: "button" },
		});
		create.addEventListener("click", () => {
			void this.submit(false);
		});

		const createAndOpen = actions.createEl("button", {
			text: t("创建并打开"),
			attr: { type: "button" },
		});
		createAndOpen.addEventListener("click", () => {
			void this.submit(true);
		});

		const cancel = actions.createEl("button", {
			text: t("取消"),
			attr: { type: "button" },
		});
		cancel.addEventListener("click", () => this.close());

		this.syncShape();
	}

	/**
	 * 这一项只在「带文件夹」形态、**且确实设了子文件夹名**时才可用：
	 * 名字留空表示资料与项目文档同目录，没有子文件夹可建。
	 */
	private syncShape(): void {
		const usable =
			this.shape === "folder" && this.deps.getSettings().materialsFolderName.trim().length > 0;
		this.materialsSetting?.setDisabled(!usable);
		this.materialsSetting?.settingEl.toggleClass("is-disabled", !usable);
		this.updateLocationHint();
	}

	private updateLocationHint(): void {
		this.locationHintEl?.setText(this.targetPath().hint);
	}

	/**
	 * 上级目录得到处都用（落点提示、快速项目落点），所以收在一个方法里：
	 * 扫描目录（下拉选的）+ 可选子文件夹。
	 */
	private parentFolder(): string {
		return resolveParentFolder(this.scanFolder, this.subFolder);
	}

	/** 目标路径（纯推导，创建前给用户看清楚东西会落在哪） */
	targetPath(): { folderPath: string; extraFolders: string[]; hint: string } {
		const parent = this.parentFolder();
		const name = this.sanitizeForDisplay();
		const settings = this.deps.getSettings();
		if (this.shape === "quick") {
			/*
			 * 快速项目落在共用的「快速项目」文件夹里，缺了由 createProject 现建。
			 * 原先直接丢在上级目录根层：设置里那个标记名看着毫无作用，提示与实际也对不上
			 * （用户口径 2026-09-20）。
			 */
			const folderPath = quickProjectFolder(parent, settings.quickProjectMarker);
			const marker = settings.quickProjectMarker.trim();
			const extras =
				marker.length === 0
					? t("，直接放在该目录下")
					: t("；缺「{marker}」文件夹会自动新建", { marker });
			return {
				folderPath,
				extraFolders: [],
				hint: t("将创建：{path}（快速项目{extras}）", {
					path: joinPath(folderPath, `${name}.md`),
					extras,
				}),
			};
		}
		const folderPath = joinPath(parent, name);
		const extraFolders =
			this.withMaterials && settings.materialsFolderName.trim().length > 0
				? [joinPath(folderPath, settings.materialsFolderName.trim())]
				: [];
		const extras =
			extraFolders.length > 0
				? t("，并预建「{name}」子文件夹", { name: settings.materialsFolderName })
				: "";
		return {
			folderPath,
			extraFolders,
			hint: t("将创建：{path}{extras}", {
				path: joinPath(folderPath, `${name}.md`),
				extras,
			}),
		};
	}

	/** 展示用名：与真正落盘时的清洗保持一致，避免提示与实际不符 */
	private sanitizeForDisplay(): string {
		const raw = this.title.trim();
		return raw.length === 0 ? t("新项目") : sanitizeNoteName(raw);
	}

	private async submit(openAfter: boolean): Promise<void> {
		if (this.busy) return;
		if (this.title.trim().length === 0) {
			this.showError(t("请填写项目名称。"));
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
				// 留空 = 不用模板，createProject 会走既有的「只写一行标题」路径
				templatePath: settings.newProjectTemplate,
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
