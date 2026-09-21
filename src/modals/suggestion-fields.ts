import { Setting, TextComponent } from "obsidian";
import { t } from "../i18n";
import { formatListInput, parseListInput } from "../services/frontmatter-mapping";

/**
 * 弹窗里的「已有值候选」字段（用户口径 2026-09-21）—— 编辑项目 / 新建项目共用。
 *
 * 抽出来的理由：编辑弹窗里早有一整套（单值走 datalist、多值走点选标签），新建弹窗却是
 * 两个裸输入框。于是同一个字段在两处长得不一样，而且「选已有值」只能在保存之后、回编辑
 * 界面才做得到——新建时恰恰最容易手打出「市场部」这种与「市场」并存的变体，之后分组与
 * 筛选会悄悄裂成两拨（这正是候选机制存在的理由，见 FieldSuggestions 的注释）。
 *
 * 候选值只来自**库里已经写过的值**（collectSuggestions），不预置、不猜。
 */

/** datalist 的 id 计数：id 在整篇文档里必须唯一（同屏开两个弹窗会撞） */
let suggestionSeq = 0;

export interface SuggestionFieldOptions {
	/** 字段说明；不传 = 不显示说明行 */
	desc?: string;
	/** 已有值候选；空数组 = 该字段没有候选，退化成纯输入框 */
	suggestions?: string[];
}

/**
 * 多值字段标签的「点一下」语义（纯函数）：已有 → 移除，没有 → 追加。
 *
 * 抽成纯函数是为了能测——标签选中态与输入框内容都由它推导，写反了会变成
 * 「点一下追加出两个」这种只在界面上看得见的错。
 */
export function toggleListValue(list: readonly string[], value: string): string[] {
	return list.includes(value)
		? list.filter((entry) => entry !== value)
		: [...list, value];
}

/** 单值字段：输入框 + 「已有值」下拉（可输入的下拉：能选已有的，也能直接打新的） */
export function addTextFieldSetting(
	host: HTMLElement,
	name: string,
	initial: string | null,
	assign: (value: string | null) => void,
	options: SuggestionFieldOptions = {},
): void {
	const setting = new Setting(host).setName(name);
	if (options.desc !== undefined) setting.setDesc(options.desc);
	setting.addText((text) => {
		text.setValue(initial ?? "");
		attachSuggestions(host, text.inputEl, options.suggestions ?? []);
		text.onChange((value) => {
			const trimmed = value.trim();
			assign(trimmed.length === 0 ? null : trimmed);
		});
	});
}

/**
 * 多值字段（领域 / 项目成员）：输入框照旧能自由写，外加一排**已有值标签**点选。
 *
 * 为什么不是 datalist：`<datalist>` 匹配的是**整个输入串**，而这里存的是
 * `市场, 运营` 这种逗号分隔列表——第二个值开始就永远匹配不上。所以多值字段用
 * 点选标签（点一下追加、再点移除），单值字段才用 datalist。
 */
export function addListFieldSetting(
	host: HTMLElement,
	name: string,
	initial: string[],
	assign: (value: string[]) => void,
	options: SuggestionFieldOptions = {},
): void {
	let current = [...initial];
	let text: TextComponent | null = null;
	const setting = new Setting(host)
		.setName(name)
		.setDesc(options.desc ?? t("多个值用逗号分隔"));
	setting.addText((component) => {
		text = component;
		component.setValue(formatListInput(initial));
		component.onChange((value) => {
			current = parseListInput(value);
			assign(current);
			renderChips();
		});
	});
	const suggestions = options.suggestions ?? [];
	if (suggestions.length === 0) return;

	// 挂在 setting 之后的**独立一块**（不塞进 setting 的 flex 行里）：那一行是
	// 「标题 | 输入框」的两列布局，多塞一个子节点只会被挤在同一行里
	const chips = host.createDiv({ cls: "pm-value-chips" });
	const renderChips = (): void => {
		chips.empty();
		for (const value of suggestions) {
			const selected = current.includes(value);
			const chip = chips.createEl("button", {
				cls: `pm-value-chip${selected ? " is-active" : ""}`,
				text: value,
				attr: {
					type: "button",
					title: selected ? t("点一下移除") : t("点一下追加"),
				},
			});
			// Modal 不是 Component，这些节点随弹窗的 contentEl.empty() 一起销毁
			chip.addEventListener("click", () => {
				current = toggleListValue(current, value);
				assign(current);
				// 回写输入框：用户看得见自己选了什么，还能接着手改
				text?.setValue(formatListInput(current));
				renderChips();
			});
		}
	};
	renderChips();
}

/**
 * 单值字段挂「已有值」下拉。
 *
 * 用原生 `<datalist>`：它是**可输入的下拉**——能选已有的，也能直接打新的，正好对上
 * 「能选尽量选，没有的才录入新增」。datalist 挂在弹窗的 contentEl 里，随弹窗一起销毁，
 * 不会在 body 上留垃圾。
 */
function attachSuggestions(host: HTMLElement, input: HTMLInputElement, values: string[]): void {
	if (values.length === 0) return;
	const doc = input.ownerDocument;
	const list = doc.createElement("datalist");
	list.className = "pm-value-suggestions";
	// id 必须显式给：`input[list]` 靠它找 datalist，留空的话下拉静默失效
	list.id = `pm-value-suggestions-${(suggestionSeq += 1)}`;
	for (const value of values) {
		const option = doc.createElement("option");
		option.setAttribute("value", value);
		list.appendChild(option);
	}
	host.appendChild(list);
	input.setAttribute("list", list.id);
}
