import { EN } from "./en";

/** 界面语言。只有中英两档：中文原文就是基准，英文靠字典 */
export type Locale = "zh" | "en";
/** 设置项取值：auto = 跟随 Obsidian 界面语言 */
export type LanguageSetting = "auto" | Locale;

export type TranslateParams = Record<string, string | number>;

/**
 * 翻译（纯函数，不读全局状态——这样可以用任意语言直接测）。
 *
 * **键就是中文原文**（用户口径 2026-09-21）。为什么不用 `settings.foo.label` 这类语义化 key：
 * 1. 迁移是逐条把原文包起来（`t("导出 SVG")`），不必为两百多条文案各起一个名字，
 *    也就没有「名字起得不好，将来又要改」的债；
 * 2. 漏翻的条目**自动退回中文**，界面上永远不会露出 `settings.foo.label` 这种生 key；
 * 3. 同一句中文在多处出现时共用一条翻译，天然去重。
 *
 * 代价是「改中文原文 = 改 key」——由 `tests/i18n.test.ts` 的源码扫描用例兜住：
 * 它把源码里所有 `t("…")` 调用的中文取出来，逐个查字典，漏翻直接报红。
 */
export function translate(locale: Locale, key: string, params?: TranslateParams): string {
	const text = locale === "en" ? (EN[key] ?? key) : key;
	return fillParams(text, params);
}

/**
 * 宿主语言标识 → 我们的两档。
 *
 * 只看前缀：`zh`、`zh-TW`、`zh-Hans` 全按中文；其余（`en`、`de`、空值）按英文。
 * 判错也不会出错内容——中文用户最多看到英文界面，改设置里的「界面语言」即可。
 */
export function detectLocale(raw: string | null | undefined): Locale {
	return (raw ?? "").trim().toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** 设置项 + 探测结果 → 实际语言（auto 时才用探测结果） */
export function resolveLocale(setting: LanguageSetting, detected: Locale): Locale {
	return setting === "auto" ? detected : setting;
}

/**
 * `{name}` 占位符替换。只替换出现在 `params` 里的名字，其余原样保留——
 * 文案里合法的花括号（例如模板示例 `{{date}}`）因此不会被误伤。
 */
function fillParams(text: string, params?: TranslateParams): string {
	if (params === undefined) return text;
	let out = text;
	for (const [name, value] of Object.entries(params)) {
		out = out.split(`{${name}}`).join(String(value));
	}
	return out;
}
