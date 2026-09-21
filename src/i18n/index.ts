import { LanguageSetting, Locale, resolveLocale, TranslateParams, translate } from "./translate";

export type { LanguageSetting, Locale, TranslateParams } from "./translate";
export { detectLocale, resolveLocale } from "./translate";

/**
 * 运行时语言状态（用户口径 2026-09-21：加字典、支持英文版）。
 *
 * 这里是一份**可变的全局状态**，故意的：`t()` 会被几百处调用点直接用，把语言当参数
 * 一路传下去会污染所有函数签名。写入点只有两个——插件 onload 与设置页改语言——
 * 都收在 `setLocale()` 里。
 *
 * **本模块刻意零依赖**（不 import obsidian）：services 层是纯函数（"零 Obsidian 依赖"
 * 是它们的既定口径），它们也要取文案（例如筛选层的状态标签）。所以「探测 Obsidian
 * 界面语言」那件事留在 main.ts（用宿主的 moment），这里只接收结论。
 *
 * 初值给 `"zh"`（= 原文）而不是 `"en"`：万一有代码在 onload 之前就取文案
 * （模块级求值、早期错误提示），显示原文总比显示英文安全。
 *
 * 注意：**不要在模块顶层求值文案**（`const X = t("…")`）——那样会把这个初值冻住。
 * 需要文案的地方一律写成函数求值（面板、甘特、设置页都是这么用的）。
 */
let current: Locale = "zh";

/** 插件 onload 与设置页改语言时调用；返回是否真的变了（变了要重渲染） */
export function setLocale(locale: Locale): boolean {
	if (locale === current) return false;
	current = locale;
	return true;
}

export function getLocale(): Locale {
	return current;
}

/**
 * 按设置项 + 探测到的宿主语言把运行时语言定下来。
 * onload 与「设置页改了语言」共用这一个入口，避免两处各写一遍解析规则。
 */
export function applyLanguageSetting(setting: LanguageSetting, detected: Locale): boolean {
	return setLocale(resolveLocale(setting, detected));
}

/** 取当前语言的文案（`t("导出 SVG")` / `t("已导出 {path}", { path })`） */
export function t(key: string, params?: TranslateParams): string {
	return translate(current, key, params);
}
