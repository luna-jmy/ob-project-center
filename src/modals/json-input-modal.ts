import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";

/**
 * JSON 文本导入 Modal（设置页的映射表导入用）。
 *
 * 只做「取文本 + 校验 JSON 语法」，语义校验交给调用方
 * （settings-migration 的清洗函数才是权威，导入进来的东西一样要过清洗）。
 */
export class JsonInputModal extends Modal {
	private text = "";
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly title: string,
		private readonly description: string,
		private readonly onApply: (values: Record<string, unknown>) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pm-modal");
		this.titleEl.setText(this.title);

		contentEl.createDiv({ cls: "pm-modal__hint", text: this.description });

		new Setting(contentEl).addTextArea((area) => {
			area.setPlaceholder('{\n  "key": "value"\n}');
			area.inputEl.rows = 12;
			area.inputEl.addClass("pm-modal__json");
			area.onChange((value) => {
				this.text = value;
			});
			area.inputEl.focus();
		});

		this.errorEl = contentEl.createDiv({ cls: "pm-modal__error" });

		// Modal 不是 Component（没有 registerDomEvent），这里的节点会在 onClose 里
		// 随 contentEl 一起销毁，监听器不会外泄到宿主对象上，因此直接用 addEventListener。
		const actions = contentEl.createDiv({ cls: "pm-modal__actions" });
		const apply = actions.createEl("button", {
			cls: "mod-cta",
			text: t("应用"),
			attr: { type: "button" },
		});
		apply.addEventListener("click", () => this.apply());

		const cancel = actions.createEl("button", {
			text: t("取消"),
			attr: { type: "button" },
		});
		cancel.addEventListener("click", () => this.close());
	}

	private apply(): void {
		const parsed = parseJsonObject(this.text);
		if (!parsed.ok) {
			this.errorEl?.setText(parsed.message);
			return;
		}
		this.onApply(parsed.value);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

type ParseResult =
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; message: string };

/** 纯函数：文本 → JSON 对象（错误信息可直接展示给用户） */
export function parseJsonObject(raw: string): ParseResult {
	const text = raw.trim();
	if (text.length === 0) {
		return { ok: false, message: t("内容为空。") };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { ok: false, message: t("JSON 语法错误：{reason}", { reason }) };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { ok: false, message: t("需要是一个 JSON 对象（以 { 开头）。") };
	}
	return { ok: true, value: parsed as Record<string, unknown> };
}
