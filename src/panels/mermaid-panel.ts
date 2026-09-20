import { App, Component, MarkdownRenderer, Setting } from "obsidian";

/**
 * Mermaid 预览 + 编辑栏（用户要求 2026-09-20）—— 右侧面板的第二个 Tab。
 *
 * 三段结构：
 * 1. **选项**：Today 竖线、排除周末、排除指定日期 —— 直接改设置并重新生成；
 * 2. **预览**：交给宿主的 Markdown 渲染器渲染（不引 mermaid 依赖、不自己塞 DOM），
 *    所见即所得——预览长什么样，粘贴到笔记里就是什么样；
 * 3. **编辑栏**：可直接改代码；一改就进「草稿」状态，复制/导出用的是草稿内容，
 *    「重新生成」把草稿丢掉回到按当前筛选/分组算出来的版本。
 *
 * 渲染用子 Component 管理：每次重渲染先 unload 上一个，
 * 否则 mermaid 生成的 DOM 与监听器会一轮轮堆在视图上（技能：Markdown 渲染子组件要托管）。
 */

export interface MermaidOptions {
	todayMarker: boolean;
	excludeWeekends: boolean;
	excludeDates: string;
}

export interface MermaidPanelHost {
	/** 当前应当展示/复制的 mermaid 全文（草稿优先） */
	getSource(): string;
	/** 是否处于草稿状态（用户改过编辑栏） */
	isDirty(): boolean;
	getOptions(): MermaidOptions;
	/** 复选框变化 → 存设置 + 重新生成 */
	onOptionsChange(patch: Partial<MermaidOptions>): void;
	/** 编辑栏内容变化（防抖后回调） */
	onSourceEdit(text: string): void;
	/** 丢弃草稿，回到生成版本 */
	onRegenerate(): void;
	onCopy(): void;
	onExportToNote(): void;
}

/** 编辑栏输入防抖：每次按键都重渲染 mermaid 会明显卡顿 */
const EDIT_DEBOUNCE_MS = 400;

export class MermaidPanel {
	private optionsEl: HTMLElement | null = null;
	private previewEl: HTMLElement | null = null;
	private editorEl: HTMLTextAreaElement | null = null;
	private dirtyHintEl: HTMLElement | null = null;

	private previewChild: Component | null = null;
	/** 渲染代次：mermaid 渲染是异步的，用它丢弃过期结果 */
	private renderGeneration = 0;
	private editTimer: number | null = null;

	constructor(
		private readonly component: Component,
		private readonly app: App,
		private readonly host: HTMLElement,
		private readonly deps: MermaidPanelHost,
	) {
		this.build();
		this.component.register(() => this.clearEditTimer());
	}

	private build(): void {
		this.host.addClass("pm-mermaid");

		this.optionsEl = this.host.createDiv({ cls: "pm-mermaid__options" });
		this.buildOptions();

		const panes = this.host.createDiv({ cls: "pm-mermaid__panes" });

		const previewWrap = panes.createDiv({ cls: "pm-mermaid__pane pm-mermaid__pane--preview" });
		previewWrap.createDiv({ cls: "pm-pane-title", text: "预览" });
		this.previewEl = previewWrap.createDiv({ cls: "pm-mermaid__preview" });

		const editorWrap = panes.createDiv({ cls: "pm-mermaid__pane pm-mermaid__pane--editor" });
		const editorHead = editorWrap.createDiv({ cls: "pm-pane-head" });
		editorHead.createDiv({ cls: "pm-pane-title", text: "编辑栏" });
		this.dirtyHintEl = editorHead.createSpan({ cls: "pm-mermaid__dirty", text: "" });

		const editor = editorWrap.createEl("textarea", {
			cls: "pm-mermaid__editor",
			attr: { spellcheck: "false", "aria-label": "Mermaid 代码，可直接编辑" },
		});
		this.editorEl = editor;
		this.component.registerDomEvent(editor, "input", () => {
			this.scheduleEdit(editor.value);
		});

		const actions = editorWrap.createDiv({ cls: "pm-modal__actions" });
		const regenerate = actions.createEl("button", {
			cls: "pm-btn",
			text: "重新生成",
			attr: { type: "button", title: "丢弃手工改动，按当前筛选/分组重新生成" },
		});
		this.component.registerDomEvent(regenerate, "click", () => this.deps.onRegenerate());

		const copy = actions.createEl("button", {
			cls: "mod-cta",
			text: "复制 Mermaid",
			attr: { type: "button" },
		});
		this.component.registerDomEvent(copy, "click", () => this.deps.onCopy());

		const exportBtn = actions.createEl("button", {
			cls: "pm-btn",
			text: "导出到笔记",
			attr: { type: "button", title: "写入指定笔记的落点标记之间" },
		});
		this.component.registerDomEvent(exportBtn, "click", () => this.deps.onExportToNote());

		this.host.createDiv({
			cls: "pm-mermaid__note",
			text: "说明：Mermaid 的 gantt 语法不支持逐任务配色，自定义颜色只影响左侧自绘甘特图，导出时会忽略。",
		});
	}

	private buildOptions(): void {
		const host = this.optionsEl;
		if (host === null) return;
		const options = this.deps.getOptions();

		new Setting(host)
			.setName("显示今天的竖线")
			.setDesc("关掉后导出的代码里就没有今天的竖线指令（默认是显示的）。")
			.addToggle((toggle) =>
				toggle.setValue(options.todayMarker).onChange((value) => {
					this.deps.onOptionsChange({ todayMarker: value });
				}),
			);

		new Setting(host)
			.setName("排除周末")
			.setDesc("开启后导出的甘特图会自动跳过周六周日，任务条按工作日连排。")
			.addToggle((toggle) =>
				toggle.setValue(options.excludeWeekends).onChange((value) => {
					this.deps.onOptionsChange({ excludeWeekends: value });
				}),
			);

		new Setting(host)
			.setName("排除日期")
			.setDesc("逗号分隔的日期，写成四位年、两位月、两位日（例如国内假期）。格式不对的会被忽略。")
			.addText((text) =>
				text
					.setPlaceholder("2026-10-01, 2026-10-02")
					.setValue(options.excludeDates)
					.onChange((value) => {
						this.deps.onOptionsChange({ excludeDates: value });
					}),
			);
	}

	/** 源变化后同步（只同步，不重建 DOM——否则编辑栏会在每次输入后被重建、光标丢失） */
	update(): void {
		const source = this.deps.getSource();
		const editor = this.editorEl;
		if (editor !== null && this.host.ownerDocument.activeElement !== editor) {
			if (editor.value !== source) editor.value = source;
		}
		this.dirtyHintEl?.setText(this.deps.isDirty() ? "（已手工修改，未重新生成）" : "");
		this.renderPreview(source);
	}

	private renderPreview(source: string): void {
		const el = this.previewEl;
		if (el === null) return;

		// 上一轮的子组件必须先卸载：mermaid 会往 DOM 里塞节点、绑监听器
		if (this.previewChild !== null) {
			this.component.removeChild(this.previewChild);
			this.previewChild = null;
		}
		el.empty();

		const generation = ++this.renderGeneration;
		const child = new Component();
		this.component.addChild(child);
		this.previewChild = child;

		void MarkdownRenderer.render(this.app, source, el, "", child)
			.then(() => {
				if (generation !== this.renderGeneration) return;
				if (el.childElementCount === 0) {
					el.createDiv({ cls: "pm-mermaid__preview-empty", text: "（没有可渲染的内容）" });
				}
			})
			.catch((error: unknown) => {
				if (generation !== this.renderGeneration) return;
				el.empty();
				el.createDiv({
					cls: "pm-mermaid__preview-error",
					text: `预览渲染失败：${describeError(error)}`,
				});
			});
	}

	private scheduleEdit(value: string): void {
		this.clearEditTimer();
		const win = this.host.ownerDocument.defaultView;
		if (win === null) return;
		this.editTimer = win.setTimeout(() => {
			this.editTimer = null;
			this.deps.onSourceEdit(value);
		}, EDIT_DEBOUNCE_MS);
	}

	private clearEditTimer(): void {
		if (this.editTimer === null) return;
		this.host.ownerDocument.defaultView?.clearTimeout(this.editTimer);
		this.editTimer = null;
	}

	destroy(): void {
		this.clearEditTimer();
		if (this.previewChild !== null) {
			this.component.removeChild(this.previewChild);
			this.previewChild = null;
		}
		this.host.empty();
	}
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
