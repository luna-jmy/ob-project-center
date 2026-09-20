import { App, Component, MarkdownRenderer } from "obsidian";

/**
 * Mermaid 预览（用户口径 2026-09-20 二次修订）—— 主区第二个 Tab，结构极简：
 * 一行控件 + 预览区。
 *
 * ── 为什么没有代码编辑区（用户明确要求去掉）──────────────────────────
 * 甘特图是**唯一可编辑版本**，预览只是它的投影。留一个可改的代码框，
 * 就等于允许出现第二份真相：改了代码、再去甘特图拖一下，两边就各说各话。
 * 去掉编辑区之后，「内容部分跟甘特图编辑区域联动」是结构上保证的——
 * 预览每次都是重新生成的，不存在过期副本。
 *
 * ── 其余口径 ────────────────────────────────────────────────────────
 * - 选项用按钮控制（chip 开关 + 一个日期输入），改完立刻重算预览并存设置；
 * - 只要一个「导出代码」按钮。
 */

export interface MermaidOptions {
	todayMarker: boolean;
	excludeWeekends: boolean;
	/** 法定节假日：输出 excludes 列表 */
	excludeDates: string;
	/** 调休补班：输出 includes 列表（优先级最高，能把周末捞回工作日） */
	includeDates: string;
}

export interface MermaidPanelHost {
	/** 当前应当展示/导出的 mermaid 全文（由甘特图模型实时生成） */
	getSource(): string;
	getOptions(): MermaidOptions;
	/** 选项变化 → 存设置 + 重算预览 */
	onOptionsChange(patch: Partial<MermaidOptions>): void;
	/** 导出代码：复制到剪贴板 */
	onExportCode(): void;
	/** 写入笔记：落到指定笔记的标记块之间（F1.7） */
	onWriteToNote(): void;
}

type ToggleKey = "todayMarker" | "excludeWeekends";
type DateFieldKey = "excludeDates" | "includeDates";

/** 开关型选项：按钮直接控制，省掉一整套 Setting 行占掉预览的高度 */
const TOGGLES: { key: ToggleKey; label: string; hint: string }[] = [
	{ key: "todayMarker", label: "今天线", hint: "导出的代码里保留今天的竖线" },
	{
		key: "excludeWeekends",
		label: "排除周末",
		hint:
			"把周六周日标成非工作日：自绘甘特图与导出的图都会把它们画成灰色列。\n" +
			"注意：任务条长度始终按起止日期算（自然日），不会因为跳过周末而缩短——" +
			"mermaid 只在任务写成「时长」时才会按工作日重排。",
	},
];

/**
 * 两个日期清单（国内日历的两半）：
 * 节假日进 excludes，调休补班进 includes——后者优先级更高，能把落在周末的补班日捞回工作日。
 */
const DATE_FIELDS: {
	key: DateFieldKey;
	label: string;
	placeholder: string;
	hint: string;
}[] = [
	{
		key: "excludeDates",
		label: "排除日期",
		placeholder: "2026-10-01~2026-10-07",
		hint:
			"临时补充的排除日期。支持区间 2026-10-01~2026-10-07（也认「至」），多条用逗号分隔；" +
			"这些日子在图上会画成灰色的非工作日。\n成规模的法定节假日建议在设置里按年份维护「法定节假日排期」，导出时会自动套用。",
	},
	{
		key: "includeDates",
		label: "调休上班",
		placeholder: "2026-10-10",
		hint:
			"临时补充的调休补班日。写法同上；这些日子强制算工作日（优先级高于排除），" +
			"用于把「周六但要上班」从灰色里捞回来。\n年度排期里的补班日会自动套用，这里只填例外。",
	},
];

/** 日期输入的防抖：每次按键都重算预览会卡，还会连着写盘 */
const INPUT_DEBOUNCE_MS = 400;

export class MermaidPanel {
	private readonly toggles = new Map<ToggleKey, HTMLButtonElement>();
	private readonly dateInputs = new Map<DateFieldKey, HTMLInputElement>();
	private previewEl: HTMLElement | null = null;

	private previewChild: Component | null = null;
	/** 渲染代次：mermaid 渲染是异步的，用它丢弃过期结果 */
	private renderGeneration = 0;
	private inputTimer: number | null = null;
	/** 防抖期间累积的改动（两个输入框共用一个定时器） */
	private pendingPatch: Partial<MermaidOptions> = {};

	constructor(
		private readonly component: Component,
		private readonly app: App,
		private readonly host: HTMLElement,
		private readonly deps: MermaidPanelHost,
	) {
		this.build();
		this.component.register(() => this.clearInputTimer());
	}

	private build(): void {
		this.host.addClass("pm-mermaid");

		const bar = this.host.createDiv({ cls: "pm-mermaid__bar" });

		for (const toggle of TOGGLES) {
			const button = bar.createEl("button", {
				cls: "pm-chip",
				text: toggle.label,
				attr: { type: "button", title: toggle.hint },
			});
			this.toggles.set(toggle.key, button);
			this.component.registerDomEvent(button, "click", () => {
				const next = !this.deps.getOptions()[toggle.key];
				this.deps.onOptionsChange(
					toggle.key === "todayMarker" ? { todayMarker: next } : { excludeWeekends: next },
				);
			});
		}

		for (const spec of DATE_FIELDS) {
			const field = bar.createEl("label", {
				cls: "pm-mermaid__field",
				attr: { title: spec.hint },
			});
			field.createSpan({ cls: "pm-mermaid__field-label", text: spec.label });
			const input = field.createEl("input", {
				cls: "pm-mermaid__input",
				attr: { type: "text", placeholder: spec.placeholder, "aria-label": spec.label },
			});
			this.dateInputs.set(spec.key, input);
			this.component.registerDomEvent(input, "input", () => {
				this.scheduleInput(
					spec.key === "excludeDates"
						? { excludeDates: input.value }
						: { includeDates: input.value },
				);
			});
		}

		// 说明折成一个小图标：常驻一行会白占预览的高度
		bar.createSpan({
			cls: "pm-mermaid__hint",
			text: "ⓘ",
			attr: {
				title:
					"Mermaid 的 gantt 语法不支持逐任务配色，自定义颜色只影响左侧自绘甘特图，导出时会忽略。",
			},
		});

		// 两个出口：复制走 / 直接落到笔记的标记块之间（用户口径 2026-09-20：两个都要）
		const actions = bar.createDiv({ cls: "pm-mermaid__actions" });

		const exportButton = actions.createEl("button", {
			cls: "pm-btn mod-cta",
			text: "导出代码",
			attr: { type: "button", title: "复制当前预览的 Mermaid 代码" },
		});
		this.component.registerDomEvent(exportButton, "click", () => this.deps.onExportCode());

		const writeButton = actions.createEl("button", {
			cls: "pm-btn",
			text: "写入笔记",
			attr: {
				type: "button",
				title: "覆盖指定笔记的落点标记之间的内容（标记可在设置里改）",
			},
		});
		this.component.registerDomEvent(writeButton, "click", () => this.deps.onWriteToNote());

		this.previewEl = this.host.createDiv({ cls: "pm-mermaid__preview" });
	}

	/**
	 * 与外部的唯一同步入口：甘特图状态一变就调它。
	 * 控件状态与预览内容都从 deps 现取，不缓存——缓存就会有过期副本。
	 */
	update(): void {
		const options = this.deps.getOptions();
		for (const [key, button] of this.toggles) {
			const active = options[key];
			button.toggleClass("is-active", active);
			button.setAttribute("aria-pressed", String(active));
		}
		// 正在输入的那个框不要回写：会把光标顶到末尾、中文输入法候选框也会丢
		for (const [key, input] of this.dateInputs) {
			if (this.host.ownerDocument.activeElement === input) continue;
			const value = options[key];
			if (input.value !== value) input.value = value;
		}
		this.renderPreview(this.deps.getSource());
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

	private scheduleInput(patch: Partial<MermaidOptions>): void {
		// 两个输入框共用一个定时器：累积各自的改动，一次落盘一次重渲染
		this.pendingPatch = { ...this.pendingPatch, ...patch };
		this.clearInputTimer();
		const win = this.host.ownerDocument.defaultView;
		if (win === null) return;
		this.inputTimer = win.setTimeout(() => {
			this.inputTimer = null;
			const pending = this.pendingPatch;
			this.pendingPatch = {};
			this.deps.onOptionsChange(pending);
		}, INPUT_DEBOUNCE_MS);
	}

	private clearInputTimer(): void {
		if (this.inputTimer === null) return;
		this.host.ownerDocument.defaultView?.clearTimeout(this.inputTimer);
		this.inputTimer = null;
	}

	destroy(): void {
		this.clearInputTimer();
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
