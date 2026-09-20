import { App, FuzzySuggestModal, TFile } from "obsidian";

/**
 * 「导出到笔记」的目标选择（SPEC F1.7 增强项）。
 *
 * 用官方 `FuzzySuggestModal` 而不是自组列表：键盘导航、输入法、模糊匹配都由宿主保证，
 * 也就自动满足技能对中文 IME 与可访问性的要求。
 */
export class MermaidTargetModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder("选择要写入 Mermaid 的笔记（其标记块内内容会被替换）");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}
