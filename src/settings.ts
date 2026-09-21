import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ProjectMasterPlugin from "./main";
import { JsonInputModal } from "./modals/json-input-modal";
import { BAR_COLOR_PRESETS } from "./gantt/bar-colors";
import { DAY_WIDTH } from "./gantt/time-scale";
import { nextScheduleYear, sortedScheduleYears } from "./services/holiday-schedule";
import { statusAliasMap, stringMap } from "./settings-migration";
import {
	BarDurationMode,
	CARD_FONT_SCALE_RANGE,
	DEFAULT_FIELD_MAPPING,
	DEFAULT_GANTT_BAR_COLORS,
	FIELD_MAPPING_LABELS,
	FieldMappingConfig,
	GANTT_BAR_COLOR_LABELS,
	GanttBarColors,
	GroupingMode,
	HolidayScheduleMap,
	PROJECT_STATUSES,
	ProjectStatus,
	SortMode,
	YearHolidaySchedule,
	ZoomMode,
} from "./types";

/**
 * 设置页（SPEC §5）—— 全部走 Obsidian 原生设置 API。
 *
 * 分 tab 呈现（用户口径 2026-09-20）：参数总量已经到几十条，一路往下滚既找不到东西，
 * 也看不出「哪些属于同一类」。这里按**一类一件事**切成若干 tab，每个 tab 单独一屏能看完：
 * 1. 全局参数：扫描目录（多目录）、快速项目标记、排除目录、新建项目模板、中文别名开关、日期兜底策略与天数；
 * 2. 字段映射：项目信息 ↔ frontmatter 字段名，支持 JSON 导入/导出；
 * 3. 枚举与展示：status 别名表、status/priority emoji、suggester 顺序；
 * 4. 视图偏好：默认分组/排序/缩放、每项目笔记数、甘特显示偏好；
 * 5. Mermaid 导出：导出代码块的标题、分节名与落点标记；
 * 6. 法定节假日排期：按年份维护放假区间与调休补班日（导出时按图跨度自动套用）。
 *
 * 写入有两条路，按「是否影响索引」分流：
 * - `patch()` → `onSettingsChanged()`：保存 + 清缓存 + **重扫索引**（字段映射/扫描目录这类）；
 * - `writeSchedules()`：只保存 + 刷新视图（节假日排期这类纯导出参数）。
 * 后者很重要——排期是个逐字符输入的表单，走前者会让每次按键都触发一次全库重扫。
 */

const MULTILINE_HINT = "每行一个；也可以使用逗号分隔。";

/** tab 标识。取值固定写死在代码里，只用于「记住当前停在哪一页」 */
type SettingsTabId = "global" | "fields" | "enums" | "view" | "mermaid" | "holiday";

interface SettingsTabSpec {
	id: SettingsTabId;
	/** tab 上的标题，同时也是这一页的「一个标题」 */
	label: string;
	/** 页首说明：告诉用户这一页在管什么。原来挂在各分节标题上的那句话挪到这 */
	lead: string;
	render: (host: HTMLElement) => void;
}

export class ProjectMasterSettingTab extends PluginSettingTab {
	/**
	 * 当前所在 tab。
	 *
	 * 存成实例状态而不是每次回到第一页：「恢复默认」「删除年份」这类按钮会重绘整个设置页，
	 * 若重绘后跳回第一页，用户点一次就得重新找回自己在哪。
	 */
	private activeTab: SettingsTabId = "global";

	constructor(
		app: App,
		private readonly plugin: ProjectMasterPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		this.render();
	}

	/**
	 * 实际渲染（当前 tab 的内容）。
	 * 单独拆出来是因为 `display()` 在新版 Obsidian 类型里已标记废弃（改用声明式设置定义），
	 * 而「恢复默认」这类按钮需要重绘；重绘只调本方法，不碰被废弃的入口。
	 */
	private render(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("pm-settings");

		const tabs = this.tabs();
		this.renderTabBar(containerEl, tabs);

		const body = containerEl.createDiv({
			cls: "pm-settings__body",
			attr: { role: "tabpanel" },
		});
		const active = tabs.find((tab) => tab.id === this.activeTab) ?? tabs[0];
		if (active === undefined) return;
		if (active.lead.length > 0) {
			body.createDiv({ cls: "pm-settings__lead", text: active.lead });
		}
		active.render(body);
	}

	/** 设置页的 tab 清单：一个标题一个 tab，顺序即呈现顺序 */
	private tabs(): SettingsTabSpec[] {
		return [
			{
				id: "global",
				label: "全局参数",
				lead: "扫描范围、项目识别方式与缺日期兜底。改这里会触发一次全库重新索引。",
				render: (host) => this.renderGlobalSection(host),
			},
			{
				id: "fields",
				label: "字段映射",
				lead:
					"项目信息写在 frontmatter 的哪个字段里。左边是「这是什么信息」，" +
					"右边填「写在哪个字段名里」；换模板只改这张表，不必改插件。留空表示不使用该信息。",
				render: (host) => this.renderFieldMappingSection(host),
			},
			{
				id: "enums",
				label: "枚举与展示",
				lead: "状态与优先级在界面上的中文名与图标。留空或非法值会被忽略。",
				render: (host) => this.renderEnumSection(host),
			},
			{
				id: "view",
				label: "视图偏好",
				lead: "打开 dashboard 时的初始状态，以及甘特图自身的显示偏好。",
				render: (host) => this.renderViewSection(host),
			},
			{
				id: "mermaid",
				label: "Mermaid 导出",
				lead:
					"导出代码块的格式。临时增删几天假期请用视图主区的 Mermaid 面板；" +
					"成规模的法定节假日用「法定节假日排期」按年维护。",
				render: (host) => this.renderMermaidSection(host),
			},
			{
				id: "holiday",
				label: "法定节假日排期",
				lead:
					"按年份维护「放假」与「调休上班」。导出时按甘特图跨到的年份自动套用，" +
					"不必在视图面板里手打每一天。",
				render: (host) => this.renderHolidaySection(host),
			},
		];
	}

	private renderTabBar(host: HTMLElement, tabs: readonly SettingsTabSpec[]): void {
		const bar = host.createDiv({ cls: "pm-settings__tabs", attr: { role: "tablist" } });
		for (const tab of tabs) {
			const isActive = tab.id === this.activeTab;
			const button = bar.createEl("button", {
				cls: `pm-settings__tab${isActive ? " is-active" : ""}`,
				text: tab.label,
				attr: { type: "button", role: "tab", "aria-selected": String(isActive) },
			});
			button.addEventListener("click", () => this.switchTab(tab.id, false));
			button.addEventListener("keydown", (evt) => this.onTabKeyDown(evt, tabs, tab.id));
		}
	}

	private switchTab(id: SettingsTabId, focus: boolean): void {
		if (id === this.activeTab) return;
		this.activeTab = id;
		this.render();
		// 键盘切换后必须把焦点交给新的 tab：重绘会销毁原来的按钮，
		// 不交还的话焦点掉回文档开头，键盘用户等于被踢出设置页
		if (focus) {
			this.containerEl.querySelector<HTMLElement>(".pm-settings__tab.is-active")?.focus();
		}
	}

	/** 方向键 / Home / End 在 tab 之间移动（WAI-ARIA tabs 的标准键盘行为） */
	private onTabKeyDown(
		evt: KeyboardEvent,
		tabs: readonly SettingsTabSpec[],
		current: SettingsTabId,
	): void {
		const index = tabs.findIndex((tab) => tab.id === current);
		if (index === -1) return;
		let next = index;
		if (evt.key === "ArrowRight") next = (index + 1) % tabs.length;
		else if (evt.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
		else if (evt.key === "Home") next = 0;
		else if (evt.key === "End") next = tabs.length - 1;
		else return;
		evt.preventDefault();
		const target = tabs[next];
		if (target !== undefined) this.switchTab(target.id, true);
	}

	// ────────────────────────── 1. 全局参数 ──────────────────────────

	private renderGlobalSection(host: HTMLElement): void {
		new Setting(host)
			.setName("项目扫描目录")
			.setDesc(`扫描这些目录下的项目笔记。${MULTILINE_HINT}`)
			.addTextArea((area) => {
				area.setValue(this.plugin.settings.scanFolders.join("\n"));
				area.inputEl.rows = 3;
				area.onChange(async (value) => {
					await this.patch({
						scanFolders: splitLines(value),
					});
				});
			});

		new Setting(host)
			.setName("快速项目路径标记")
			.setDesc(
				"路径中出现这个完整文件夹名的文件夹归入「快速项目」分区（按完整路径段匹配，不做子串匹配）。" +
					"**留空 = 只把扫描目录根层的项目算快速项目**，新建的快速项目也直接放在扫描目录下。",
			)
			.addText((text) =>
				text
					.setPlaceholder("留空 = 只认扫描目录根层")
					.setValue(this.plugin.settings.quickProjectMarker)
					.onChange(async (value) => {
						/*
						 * 允许留空（用户口径 2026-09-20）：空 = 只认扫描目录根层，
						 * 新建的快速项目也直接落在扫描目录下。
						 * 原来空输入被忽略，而这是逐字符写入的输入框——删到只剩中间态时
						 * 那个半截名字已经落盘，跟「资料子文件夹名」是同一个 bug。
						 */
						await this.writeViewOnly({ quickProjectMarker: value.trim() });
					}),
			);

		new Setting(host)
			.setName("排除目录")
			.setDesc(
				`这些目录不参与索引。Obsidian 配置目录会自动并入，无需手写。${MULTILINE_HINT}`,
			)
			.addTextArea((area) => {
				area.setValue(this.plugin.settings.excludedFolders.join("\n"));
				area.inputEl.rows = 3;
				area.onChange(async (value) => {
					await this.patch({ excludedFolders: splitLines(value) });
				});
			});

		new Setting(host)
			.setName("资料子文件夹名")
			.setDesc(
				"新建「带文件夹」形态的项目时预建这个子文件夹。**留空表示不建**：" +
					"资料与项目文档放在同一个文件夹里（资料归集同时收同层与子文件夹里的笔记，留空不影响统计）。",
			)
			.addText((text) =>
				text
					.setPlaceholder("留空 = 资料与项目文档同目录")
					.setValue(this.plugin.settings.materialsFolderName)
					.onChange(async (value) => {
						/*
						 * 允许留空（用户口径 2026-09-20）。
						 * 原来空值被直接忽略，而这是个逐字符写入的输入框：删到只剩「资」时中间态
						 * 已经落盘，再删成空串被忽略 —— 于是「删掉它、退出再打开」会看到「资」。
						 */
						await this.writeViewOnly({ materialsFolderName: value.trim() });
					}),
			);

		new Setting(host)
			.setName("新建项目模板")
			.setDesc(
				"留空 = 与原来一样（只写一行标题）。填模板笔记路径后，新建项目的正文用模板的，" +
					"模板里缺的字段才由弹窗补上；模板里的 Templater 命令（<% %>）会被执行。" +
					"路径填 vault 相对路径（如 900 Assets/910 Templates/TPL-Project），扩展名 .md 可省略。",
			)
			.addText((text) =>
				text
					.setPlaceholder("例如：templates/TPL-Project.md")
					.setValue(this.plugin.settings.newProjectTemplate)
					.onChange(async (value) => {
						// 逐字符输入的表单：走不重扫索引的写入口（理由同节假日排期）
						await this.writeViewOnly({ newProjectTemplate: value.trim() });
					}),
			);

		new Setting(host)
			.setName("兼容中文状态别名")
			.setDesc("开启后，「执行中」「完成」等模板中文值会被识别为对应状态。历史数据建议保持开启。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.chineseAliasCompat).onChange(async (value) => {
					await this.patch({ chineseAliasCompat: value });
				}),
			);

		new Setting(host)
			.setName("缺日期兜底策略")
			.setDesc("项目缺起始或截止日期时，甘特图如何处理。")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("offset7", "按天数推导（与现有脚本一致）")
					.addOption("mark-invalid", "不推导，不上甘特图并提示修复")
					.setValue(this.plugin.settings.dateFallback)
					.onChange(async (value) => {
						await this.patch({
							dateFallback: value === "mark-invalid" ? "mark-invalid" : "offset7",
						});
					}),
			);

		new Setting(host)
			.setName("兜底天数")
			.setDesc("仅在「按天数推导」策略下生效（现有脚本硬编码为 7 天）。")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.setValue(String(this.plugin.settings.dateFallbackDays));
				text.onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isInteger(parsed) || parsed < 1) return;
					await this.patch({ dateFallbackDays: parsed });
				});
			});
	}

	// ────────────────────────── 2. 字段映射 ──────────────────────────

	private renderFieldMappingSection(host: HTMLElement): void {
		const entries = Object.keys(DEFAULT_FIELD_MAPPING) as (keyof FieldMappingConfig)[];
		for (const logicalKey of entries) {
			/*
			 * 标题写「这是什么信息」，输入框填「写在 frontmatter 的哪个字段名里」。
			 *
			 * 原来标题直接印逻辑字段名（`completionDate` 这种），那是给代码看的：
			 * 用户既不知道它对应模板里的哪条信息，也不知道该往 frontmatter 写什么。
			 * 现在标题是人话含义，默认字段名放在说明与 placeholder 里，
			 * 想换成自己的模板就照着改右边这一格。
			 */
			const meta = FIELD_MAPPING_LABELS[logicalKey];
			new Setting(host)
				.setName(meta.label)
				.setDesc(`${meta.desc}（默认：${DEFAULT_FIELD_MAPPING[logicalKey]}；留空表示不使用）`)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.fieldMapping[logicalKey])
						.setPlaceholder(DEFAULT_FIELD_MAPPING[logicalKey])
						.onChange(async (value) => {
							const fieldMapping: FieldMappingConfig = {
								...this.plugin.settings.fieldMapping,
								[logicalKey]: value.trim(),
							};
							await this.patch({ fieldMapping });
						}),
				);
		}

		new Setting(host)
			.setName("导入 / 导出映射表")
			.setDesc("导出为 JSON 便于在多 vault 或换模板时复用；导入内容会先过一遍清洗。")
			.addButton((button) =>
				button.setButtonText("导出").onClick(async () => {
					const json = JSON.stringify(this.plugin.settings.fieldMapping, null, 2);
					const ok = await copyToClipboard(json, this.containerEl.ownerDocument);
					new Notice(ok ? "映射表 JSON 已复制到剪贴板" : "复制失败：剪贴板不可用");
				}),
			)
			.addButton((button) =>
				button.setButtonText("导入").onClick(() => {
					new JsonInputModal(
						this.app,
						"导入字段映射表",
						"粘贴字段映射 JSON（逻辑字段名 → 物理字段名）。",
						(values) => {
							const imported = stringMap(values) ?? {};
							void this.patch({
								fieldMapping: {
									...this.plugin.settings.fieldMapping,
									...imported,
								},
							});
						},
					).open();
				}),
			)
			.addButton((button) =>
				button.setButtonText("恢复默认").onClick(async () => {
					await this.patch({ fieldMapping: { ...DEFAULT_FIELD_MAPPING } });
					this.render();
				}),
			);
	}

	// ────────────────────────── 3. 枚举与展示 ──────────────────────────

	private renderEnumSection(host: HTMLElement): void {
		this.renderJsonMapSetting(
			host,
			"状态中文别名映射",
			"中文写法 → 规范状态值。仅在「兼容中文状态别名」开启时生效；指向未知状态的项会被丢弃。",
			() => this.plugin.settings.statusAliases,
			async (values) => {
				const cleaned = statusAliasMap(values);
				await this.patch({ statusAliases: cleaned ?? { ...this.plugin.settings.statusAliases } });
			},
		);

		this.renderJsonMapSetting(
			host,
			"状态 emoji",
			"规范状态值 → 徽章 emoji。",
			() => this.plugin.settings.statusEmoji,
			async (values) => {
				await this.patch({ statusEmoji: stringMap(values) ?? {} });
			},
		);

		this.renderJsonMapSetting(
			host,
			"优先级 emoji",
			"优先级值（1–5）→ 徽章 emoji。",
			() => this.plugin.settings.priorityEmoji,
			async (values) => {
				await this.patch({ priorityEmoji: stringMap(values) ?? {} });
			},
		);

		new Setting(host)
			.setName("状态选择顺序")
			.setDesc(
				`编辑 Modal 下拉与筛选 chips 的展示顺序，逗号分隔。合法值：${PROJECT_STATUSES.join(", ")}`,
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.statusOrder.join(", "))
					.onChange(async (value) => {
						const order = parseStatusOrder(value);
						if (order.length === 0) return;
						await this.patch({ statusOrder: order });
					}),
			);
	}

	private renderJsonMapSetting(
		host: HTMLElement,
		name: string,
		desc: string,
		read: () => Record<string, string>,
		write: (values: Record<string, unknown>) => Promise<void>,
	): void {
		new Setting(host)
			.setName(name)
			.setDesc(`${desc}（JSON 对象，改动后自动保存）`)
			.addTextArea((area) => {
				area.setValue(JSON.stringify(read(), null, 2));
				area.inputEl.rows = 6;
				area.inputEl.addClass("pm-settings__json");
				area.onChange(async (value) => {
					const parsed = tryParseObject(value);
					if (parsed === null) return; // 语法未完成时不写入，避免中途态破坏配置
					await write(parsed);
				});
			});
	}

	// ────────────────────────── 4. 视图偏好 ──────────────────────────

	private renderViewSection(host: HTMLElement): void {
		new Setting(host).setName("默认分组依据").addDropdown((dropdown) =>
			dropdown
				.addOption("folder", "按文件夹")
				.addOption("objective", "按目标")
				.addOption("area", "按领域")
				.addOption("none", "不分组（按是否有资料）")
				.setValue(this.plugin.settings.defaultGrouping)
				.onChange(async (value) => {
					await this.patch({ defaultGrouping: value as GroupingMode });
				}),
		);

		new Setting(host).setName("默认排序").addDropdown((dropdown) =>
			dropdown
				.addOption("due-asc", "截止日升序")
				.addOption("name", "项目名")
				.addOption("priority", "优先级")
				.setValue(this.plugin.settings.defaultSort)
				.onChange(async (value) => {
					await this.patch({ defaultSort: value as SortMode });
				}),
		);

		new Setting(host)
			.setName("默认缩放")
			.setDesc(
				`各档位的每日像素宽度：日 ${DAY_WIDTH.day}px / 周 ${DAY_WIDTH.week}px / 月 ${DAY_WIDTH.month}px`,
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("day", "日")
					.addOption("week", "周")
					.addOption("month", "月")
					.addOption("year", "年（一屏看全年）")
					.setValue(this.plugin.settings.defaultZoom)
					.onChange(async (value) => {
						await this.patch({ defaultZoom: value as ZoomMode });
					}),
			);

		new Setting(host)
			.setName("默认年度筛选")
			.setDesc(
				"打开视图时「项目开始年度」的默认值。默认只显示本年度启动的项目；改为「不限年度」可一进来就看到全部项目。",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("current", "只看本年度启动的项目")
					.addOption("none", "不限年度（显示全部年份）")
					.setValue(this.plugin.settings.defaultYearFilter)
					.onChange(async (value) => {
						await this.patch({
							defaultYearFilter: value === "none" ? "none" : "current",
						});
					}),
			);

		new Setting(host)
			.setName("每项目笔记预览条数")
			.setDesc("分组卡片里最多显示几条组内笔记；0 表示不限（现有笔记数上限行为）。")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text.setValue(String(this.plugin.settings.maxNotesPerProject));
				text.onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isInteger(parsed) || parsed < 0) return;
					await this.patch({ maxNotesPerProject: parsed });
				});
			});

		new Setting(host)
			.setName("面板文字大小")
			.setDesc(
				"百分比，100 = 跟随主题默认。只缩放面板卡片里的文字（标题 / 正文 / 注释的层级比例不变），" +
					`可填 ${CARD_FONT_SCALE_RANGE.min}–${CARD_FONT_SCALE_RANGE.max}。`,
			)
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = String(CARD_FONT_SCALE_RANGE.min);
				text.inputEl.max = String(CARD_FONT_SCALE_RANGE.max);
				text.inputEl.step = "5";
				text.setValue(String(this.plugin.settings.cardFontScale));
				text.onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isInteger(parsed)) return;
					// 越界忽略而不是夹取：夹取会让人以为自己改对了
					if (parsed < CARD_FONT_SCALE_RANGE.min || parsed > CARD_FONT_SCALE_RANGE.max) return;
					await this.patch({ cardFontScale: parsed });
				});
			});

		new Setting(host)
			.setName("手动排序记录")
			.setDesc(
				"面板上拖动分组/项目会记在这里（只有排序档为「手动排序」时生效）。项目改名或删除后可能残留无效项，可一键清空。",
			)
			.addButton((button) =>
				button.setButtonText("清空").onClick(async () => {
					await this.patch({ manualGroupOrder: {}, manualProjectOrder: {} });
					new Notice("已清空手动排序记录");
				}),
			);

		new Setting(host)
			.setName("条上显示天数")
			.setDesc(
				"在甘特条上标出天数。「工作日」= 自然日 − 周末（需在 Mermaid 标签页打开「排除周末」）" +
					"− 法定节假日排期 + 补班日；与导出 mermaid 的 excludes/includes 是同一份口径。" +
					"条子太窄放不下时会挪到条子右侧显示。",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("off", "不显示")
					.addOption("calendar", "自然日（含首尾）")
					.addOption("workday", "工作日")
					.setValue(this.plugin.settings.ganttBarDuration)
					.onChange(async (value) => {
						await this.patch({ ganttBarDuration: value as BarDurationMode });
					}),
			);

		// 甘特条配色：只给「Mermaid 里颜色会变」的几类（用户口径 2026-09-20）
		new Setting(host)
			.setName("甘特条配色")
			.setDesc(
				"只给「Mermaid 里颜色会变」的几类预设颜色，其余状态共用「其他状态」。" +
					"颜色可写 #3b82f6、var(--color-blue) 或颜色名；点下面的色块即改。",
			);
		for (const key of Object.keys(DEFAULT_GANTT_BAR_COLORS) as (keyof GanttBarColors)[]) {
			this.renderBarColorSetting(host, key);
		}
	}

	/**
	 * 一类条色 = 一行文本输入 + 一排预设色块。
	 *
	 * 预设色块直接复用编辑弹窗里那套 `.pm-color-swatch`（含它踩过的坑：颜色写在元素上，
	 * 不经过自定义属性中转），取值都是主题色变量，明暗主题自动适配。
	 */
	private renderBarColorSetting(host: HTMLElement, key: keyof GanttBarColors): void {
		const meta = GANTT_BAR_COLOR_LABELS[key];
		const current = this.plugin.settings.ganttBarColors[key];

		new Setting(host)
			.setName(meta.label)
			.setDesc(`${meta.desc}（默认：${DEFAULT_GANTT_BAR_COLORS[key]}）`)
			.addText((text) =>
				text
					.setValue(current)
					.setPlaceholder(DEFAULT_GANTT_BAR_COLORS[key])
					.onChange(async (value) => {
						const trimmed = value.trim();
						// 清空会让这一类的条子失去颜色，忽略空输入而不是写坏配置
						if (trimmed.length === 0) return;
						await this.patchBarColor(key, trimmed);
					}),
			);

		const swatches = host.createDiv({ cls: "pm-color-presets" });
		for (const preset of BAR_COLOR_PRESETS) {
			// 「默认（按状态）」这一档在这里没有意义：四类颜色各自都有默认值
			if (preset.value === null) continue;
			const swatch = swatches.createEl("button", {
				cls: `pm-color-swatch${preset.value === current ? " is-active" : ""}`,
				attr: { type: "button", title: preset.label, "aria-label": preset.label },
			});
			swatch.style.backgroundColor = preset.value;
			swatch.addEventListener("click", () => void this.applyBarColor(key, preset.value));
		}
	}

	private async applyBarColor(key: keyof GanttBarColors, value: string | null): Promise<void> {
		if (value === null) return;
		await this.patchBarColor(key, value);
		// 重绘让文本框与色块高亮跟上；render 会保留当前 tab，用户不会被弹回第一页
		this.render();
	}

	private async patchBarColor(key: keyof GanttBarColors, value: string): Promise<void> {
		await this.patch({
			ganttBarColors: { ...this.plugin.settings.ganttBarColors, [key]: value },
		});
	}

	// ────────────────────────── 5. Mermaid 导出 ──────────────────────────

	/**
	 * Mermaid 导出格式。
	 *
	 * 从「视图偏好」里独立出来：视图偏好那一页已经很长，而导出格式是另一件事
	 * （改它不影响界面观感，只影响写进笔记的代码块）。
	 */
	private renderMermaidSection(host: HTMLElement): void {
		new Setting(host)
			.setName("Mermaid 标题")
			.setDesc("导出代码块里的 title 行（现有脚本为「项目进度甘特图」）。")
			.addText((text) =>
				text.setValue(this.plugin.settings.mermaidTitle).onChange(async (value) => {
					const trimmed = value.trim();
					if (trimmed.length === 0) return;
					await this.patch({ mermaidTitle: trimmed });
				}),
			);

		new Setting(host)
			.setName("Mermaid 无目标分节名")
			.setDesc("项目没有 objective 时落入的分节名（现有脚本为「默认项目」）。")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.mermaidSectionFallback)
					.onChange(async (value) => {
						const trimmed = value.trim();
						if (trimmed.length === 0) return;
						await this.patch({ mermaidSectionFallback: trimmed });
					}),
			);

		new Setting(host)
			.setName("导出落点标记（开始 / 结束）")
			.setDesc(
				"「导出到笔记」会替换这两个标记之间的内容。默认复用 gantt-builder 的占位块；标记缺失时插件会报错且不改动笔记。",
			)
			.addText((text) =>
				text.setValue(this.plugin.settings.mermaidMarkerStart).onChange(async (value) => {
					const trimmed = value.trim();
					if (trimmed.length === 0) return;
					await this.patch({ mermaidMarkerStart: trimmed });
				}),
			)
			.addText((text) =>
				text.setValue(this.plugin.settings.mermaidMarkerEnd).onChange(async (value) => {
					const trimmed = value.trim();
					if (trimmed.length === 0) return;
					await this.patch({ mermaidMarkerEnd: trimmed });
				}),
			);
	}

	// ────────────────────────── 6. 法定节假日排期 ──────────────────────────

	/**
	 * 年度排期表（用户要求 2026-09-20）。
	 *
	 * 为什么按年：国内假期是逐年公告的，而且**每条都是区间**（国庆就是 10-01~10-07）。
	 * 让人在视图面板里手打 7 个日期既啰嗦又容易漏；这里写一次「10-01~10-07」，
	 * 导出时按甘特图跨到的年份自动套用。
	 */
	private renderHolidaySection(host: HTMLElement): void {
		const schedules = this.plugin.settings.holidaySchedules;
		const years = sortedScheduleYears(schedules);
		if (years.length === 0) {
			new Setting(host)
				.setName("还没有排期")
				.setDesc("点下面的按钮添加一个年度，之后按国务院公告填区间即可。");
		}

		for (const year of years) {
			const schedule: YearHolidaySchedule = schedules[year] ?? {
				holidays: "",
				makeupWorkdays: "",
			};

			new Setting(host)
				.setName(`${year} · 放假`)
				.setDesc("区间写成 10-01~10-07（`~`/`至` 都认）；跨年区间如 12-30~01-02 自动算到次年。")
				.addText((text) =>
					text
						.setPlaceholder("10-01~10-07, 01-01~01-03")
						.setValue(schedule.holidays)
						.onChange(async (value) => {
							await this.patchSchedule(year, { holidays: value });
						}),
				)
				.addExtraButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("删除该年度排期")
						.onClick(async () => {
							const next: HolidayScheduleMap = { ...schedules };
							delete next[year];
							await this.writeSchedules(next);
							this.render();
						}),
				);

			new Setting(host)
				.setName(`${year} · 调休上班`)
				.setDesc(
					"这些日子强制算工作日（优先级高于放假），用于把「周六但要上班」从灰色非工作日里捞回来。",
				)
				.addText((text) =>
					text
						.setPlaceholder("09-27, 10-10")
						.setValue(schedule.makeupWorkdays)
						.onChange(async (value) => {
							await this.patchSchedule(year, { makeupWorkdays: value });
						}),
				);
		}

		new Setting(host)
			.setName("新增年度")
			.setDesc("每年公告出来后，添一个年度再填区间即可。")
			.addButton((button) =>
				button.setButtonText("添加年份").onClick(async () => {
					const year = nextScheduleYear(schedules);
					await this.writeSchedules({
						...schedules,
						[year]: { holidays: "", makeupWorkdays: "" },
					});
					this.render();
				}),
			);
	}

	private async patchSchedule(
		year: string,
		patch: Partial<YearHolidaySchedule>,
	): Promise<void> {
		const current = this.plugin.settings.holidaySchedules;
		const existing: YearHolidaySchedule = current[year] ?? { holidays: "", makeupWorkdays: "" };
		await this.writeSchedules({ ...current, [year]: { ...existing, ...patch } });
	}

	/**
	 * 排期写入口（语义化的薄封装，实现见 writeViewOnly）。
	 */
	private async writeSchedules(holidaySchedules: HolidayScheduleMap): Promise<void> {
		await this.writeViewOnly({ holidaySchedules });
	}

	// ────────────────────────── 写入收口 ──────────────────────────

	/**
	 * 「只影响显示/导出」类参数的写入口：落设置 + 刷新视图，**不重扫索引**。
	 *
	 * 判断标准是「这个参数会不会改变索引结果」：节假日排期（只在导出时读）与新建项目模板
	 * （只在新建时读）都不会，而它们都是逐字符输入的表单。走 patch() 的话，
	 * 敲 20 个字符 = 20 次全库重扫（技能：区分「改动影响索引」与「只影响显示」）。
	 */
	private async writeViewOnly(patch: Partial<ProjectMasterPlugin["settings"]>): Promise<void> {
		this.plugin.settings = { ...this.plugin.settings, ...patch };
		await this.plugin.persistSettings();
		this.plugin.requestRefresh();
	}

	/** 唯一的设置写入口：先落盘并重扫索引，保证 UI 与索引不会出现「设置改了但数据没变」 */
	private async patch(patch: Partial<ProjectMasterPlugin["settings"]>): Promise<void> {
		this.plugin.settings = { ...this.plugin.settings, ...patch };
		await this.plugin.onSettingsChanged();
	}
}

// ────────────────────────── 纯函数助手 ──────────────────────────

/** 多行/逗号分隔输入 → 去空白、去重的数组 */
export function splitLines(raw: string): string[] {
	const out: string[] = [];
	for (const chunk of raw.split(/[\n,，]/)) {
		const value = chunk.trim();
		if (value.length > 0 && !out.includes(value)) out.push(value);
	}
	return out;
}

/** JSON 文本 → 对象；语法不完整（用户还在输入）返回 null，不做任何写入 */
export function tryParseObject(raw: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return null;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** 逗号分隔的状态顺序：过滤非法值、去重（结果为空表示输入无效，调用方应忽略） */
export function parseStatusOrder(raw: string): ProjectStatus[] {
	const order: ProjectStatus[] = [];
	for (const chunk of raw.split(/[,，\s]+/)) {
		const value = chunk.trim();
		if (!(PROJECT_STATUSES as string[]).includes(value)) continue;
		if (!order.includes(value as ProjectStatus)) order.push(value as ProjectStatus);
	}
	return order;
}

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
