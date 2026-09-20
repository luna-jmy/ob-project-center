import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ProjectMasterPlugin from "./main";
import { JsonInputModal } from "./modals/json-input-modal";
import { DAY_WIDTH } from "./gantt/time-scale";
import { statusAliasMap, stringMap } from "./settings-migration";
import {
	DEFAULT_FIELD_MAPPING,
	FieldMappingConfig,
	GroupingMode,
	PROJECT_STATUSES,
	ProjectStatus,
	SortMode,
	ZoomMode,
} from "./types";

/**
 * 设置页（SPEC §5）—— 四组参数，全部走 Obsidian 原生设置 API。
 *
 * 参数分离的落点（agent.md §2.5「代码零硬编码业务常量」）：
 * 1. 全局参数：扫描目录（多目录）、快速项目标记、排除目录、中文别名开关、日期兜底策略与天数；
 * 2. 字段映射参数：TPL-Project 的每个业务字段 ↔ 逻辑字段，支持 JSON 导入/导出；
 * 3. 枚举与展示参数：status 别名表、status/priority emoji、suggester 顺序；
 * 4. 视图偏好：默认分组/排序/缩放、每项目笔记数、甘特是否隐藏已取消、Mermaid 导出格式。
 *
 * 全部写操作经 `plugin.onSettingsChanged()` 收口：保存 + 清缓存 + 重扫索引。
 * 映射表这类「有语义的 JSON」在写入前过一遍清洗函数，坏数据不会进配置。
 */

const MULTILINE_HINT = "每行一个；也可以使用逗号分隔。";

export class ProjectMasterSettingTab extends PluginSettingTab {
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
	 * 实际渲染。
	 * 单独拆出来是因为 `display()` 在新版 Obsidian 类型里已标记废弃（改用声明式设置定义），
	 * 而「恢复默认」这类按钮需要重绘；重绘只调本方法，不碰被废弃的入口。
	 */
	private render(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("pm-settings");

		this.renderGlobalSection(containerEl);
		this.renderFieldMappingSection(containerEl);
		this.renderEnumSection(containerEl);
		this.renderViewSection(containerEl);
	}

	// ────────────────────────── 1. 全局参数 ──────────────────────────

	private renderGlobalSection(host: HTMLElement): void {
		new Setting(host).setName("全局参数").setHeading();

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
			.setDesc("路径中出现这个完整文件夹名时，归入「快速项目」分区（按完整路径段匹配，不做子串匹配）。")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.quickProjectMarker)
					.onChange(async (value) => {
						const trimmed = value.trim();
						// 空标记会让「快速项目」判定失去意义，忽略空输入而不是写坏配置
						if (trimmed.length === 0) return;
						await this.patch({ quickProjectMarker: trimmed });
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
				"新建「带文件夹」形态的项目时可一并预建这个子文件夹，用于放该项目的资料/笔记。",
			)
			.addText((text) =>
				text.setValue(this.plugin.settings.materialsFolderName).onChange(async (value) => {
					const trimmed = value.trim();
					if (trimmed.length === 0) return;
					await this.patch({ materialsFolderName: trimmed });
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
		new Setting(host)
			.setName("字段映射")
			.setDesc(
				"逻辑字段 → frontmatter 物理字段名。换模板时只改这张表，不动代码。留空表示该字段不使用。",
			)
			.setHeading();

		const entries = Object.keys(DEFAULT_FIELD_MAPPING) as (keyof FieldMappingConfig)[];
		for (const logicalKey of entries) {
			const setting = new Setting(host).setName(logicalKey);
			if (logicalKey === "identifyTag") {
				setting.setDesc(
					"用于「补充识别」项目的标签名（写在笔记的 tags 里）。留空则只按 type 字段识别，资料/笔记不会被误认成项目。",
				);
			}
			setting.addText((text) =>
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
		new Setting(host)
			.setName("枚举与展示")
			.setDesc("状态/优先级在 UI 上的标签与图标。留空或非法值会被忽略。")
			.setHeading();

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
		new Setting(host)
			.setName("视图偏好")
			.setDesc("打开 dashboard 时的初始状态；导出格式相关设置也在这里。")
			.setHeading();

		new Setting(host).setName("默认分组依据").addDropdown((dropdown) =>
			dropdown
				.addOption("folder", "按文件夹")
				.addOption("objective", "按目标")
				.addOption("area", "按领域")
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
			.setName("甘特图隐藏已取消项目")
			.setDesc("现有脚本行为：cancelled 项目默认不上甘特图。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.hideCancelledInGantt).onChange(async (value) => {
					await this.patch({ hideCancelledInGantt: value });
				}),
			);

		new Setting(host)
			.setName("Mermaid 导出选项")
			.setDesc(
				"「今天竖线」「排除周末」「排除日期」三个开关在视图右侧的 Mermaid 标签页里直接调，改完即时预览。",
			);

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

	// ────────────────────────── 写入收口 ──────────────────────────

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
