import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN } from "../src/i18n/en";
import { detectLocale, resolveLocale, translate } from "../src/i18n/translate";
import {
	barColorCopy,
	DEFAULT_FIELD_MAPPING,
	DEFAULT_GANTT_BAR_COLORS,
	fieldCopy,
	priorityLabel,
	PROJECT_STATUSES,
	statusLabel,
} from "../src/types";

/*
 * 字典（用户口径 2026-09-21：加字典、支持英文版）。
 *
 * 键就是中文原文，所以「翻译」是纯查表 + 占位符替换——这里把三条口径固化：
 * 1. 中文原样返回、英文查表、查不到退回原文（界面永远不会露出生 key）；
 * 2. `{name}` 只替换传入的名字，其它花括号（模板示例 `{{date}}`）原样保留；
 * 3. 宿主语言 → 中英两档，设置可以强行覆盖。
 */
describe("translate（纯函数）", () => {
	it("returns the source text for zh", () => {
		expect(translate("zh", "导出 SVG")).toBe("导出 SVG");
	});

	it("returns the English entry when there is one", () => {
		expect(translate("en", "执行中")).toBe("In progress");
	});

	it("falls back to the source text when the entry is missing", () => {
		// 漏翻宁可显示中文，也不要露出 "settings.foo.label" 这种生 key
		expect(translate("en", "这句还没翻译")).toBe("这句还没翻译");
	});

	it("fills {placeholders} and leaves every other brace alone", () => {
		expect(translate("zh", "已导出 {path}", { path: "a/b.svg" })).toBe("已导出 a/b.svg");
		// 没传 path 就原样保留；{{date:YYYYMM}} 是模板示例，不能被动
		expect(translate("zh", "已导出 {path}")).toBe("已导出 {path}");
		expect(translate("zh", "{{date:YYYYMM}} 原样", { path: "x" })).toBe("{{date:YYYYMM}} 原样");
	});

	it("replaces every occurrence and renders numbers", () => {
		expect(translate("zh", "{a}-{a}", { a: "x" })).toBe("x-x");
		expect(translate("zh", "共 {count} 项", { count: 12 })).toBe("共 12 项");
	});
});

describe("语言解析", () => {
	it("treats every zh variant as Chinese and everything else as English", () => {
		expect(detectLocale("zh")).toBe("zh");
		expect(detectLocale("zh-TW")).toBe("zh");
		expect(detectLocale(" zh-Hans ")).toBe("zh");
		expect(detectLocale("en")).toBe("en");
		expect(detectLocale("de-DE")).toBe("en");
		expect(detectLocale(null)).toBe("en");
		expect(detectLocale(undefined)).toBe("en");
	});

	it("lets the setting override the detected language", () => {
		expect(resolveLocale("auto", "en")).toBe("en");
		expect(resolveLocale("auto", "zh")).toBe("zh");
		expect(resolveLocale("zh", "en")).toBe("zh");
		expect(resolveLocale("en", "zh")).toBe("en");
	});
});

/*
 * 覆盖守卫：扫源码里所有 `t("…")`，凡是中文都得在字典里有条目。
 *
 * 这条是这套「键=原文」方案的关键配套：改文案等于改 key，忘了同步字典不会被任何
 * 类型检查发现（`EN[key]` 的键类型就是 string）。扫描是启发式的——只认**字面量**
 * 参数（引号或反引号紧跟），拼接出来的 key 本来也不该出现在字典里。
 */
describe("字典覆盖（源码扫描）", () => {
	const files = collectSources(join(import.meta.dirname, "..", "src"));
	const keys = files.flatMap((file) => tKeysIn(stripComments(readFileSync(file, "utf8"))));

	it("finds the dictionary keys actually used in the source", () => {
		/*
		 * 扫到的条数会随迁移进度变（还没包 t() 的文案不算），所以不按数量断言，
		 * 只钉两条**确定存在**的文案：正则或路径坏了就会漏，测试不会静默变成摆设。
		 */
		expect(keys).toContain("界面语言");
		expect(keys).toContain("无法识别（frontmatter 里的状态值非法）");
	});

	it("has an English entry for every Chinese string wrapped in t()", () => {
		const missing = keys.filter((key) => isChinese(key) && EN[key] === undefined);
		expect(missing).toEqual([]);
	});
});

/*
 * 上面那条扫描只看得见字面量 `t("…")`，看不见「原文表 + 取值函数」那种写法
 * （`statusLabel()` / `fieldCopy()` 里存的是原文常量）。这里从**公开入口**取中文
 * （中文字典就是返回原文的口径），逐个查英文表——两种写法都覆盖到了。
 */
describe("字典覆盖（取值函数）", () => {
	it("has English entries for every status and priority label", () => {
		const missing: string[] = [];
		for (const status of PROJECT_STATUSES) {
			if (EN[statusLabel(status)] === undefined) missing.push(`status:${status}`);
		}
		for (const value of ["1", "2", "3", "4", "5"]) {
			if (EN[priorityLabel(value)] === undefined) missing.push(`priority:${value}`);
		}
		expect(missing).toEqual([]);
	});

	it("has English entries for every field / bar-color label and description", () => {
		const missing: string[] = [];
		for (const field of Object.keys(DEFAULT_FIELD_MAPPING) as (keyof typeof DEFAULT_FIELD_MAPPING)[]) {
			const copy = fieldCopy(field);
			if (EN[copy.label] === undefined) missing.push(`field label:${field}`);
			if (EN[copy.desc] === undefined) missing.push(`field desc:${field}`);
		}
		for (const tone of Object.keys(DEFAULT_GANTT_BAR_COLORS) as (keyof typeof DEFAULT_GANTT_BAR_COLORS)[]) {
			const copy = barColorCopy(tone);
			if (EN[copy.label] === undefined) missing.push(`color label:${tone}`);
			if (EN[copy.desc] === undefined) missing.push(`color desc:${tone}`);
		}
		expect(missing).toEqual([]);
	});
});

function collectSources(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...collectSources(path));
		else if (entry.name.endsWith(".ts")) out.push(path);
	}
	return out;
}

/**
 * 去掉注释再扫。
 *
 * 注释里常拿 `t("…")` 举例（本仓库的翻译层注释就是），不剥掉会把示例当调用，
 * 报一堆「字典缺条」的假问题。只剥块注释与整行注释就够——示例都在块注释里，
 * 而字符串里的 `//`（网址之类）因此不会被误伤。
 */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * `t("…")` / `t('…')` / ``t(`…`)`` 里的字面量（不含插值，插值的 key 不进字典）。
 *
 * 取到的是**源码原文**（`\n` 还是两个字符），而运行时那串会被 JS 解成真换行，
 * 所以这里要把常见转义还原，否则多行文案会被误报成「字典缺条」。
 */
function tKeysIn(source: string): string[] {
	const out: string[] = [];
	const pattern = /\bt\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|`([^`$]*)`)/g;
	let match = pattern.exec(source);
	while (match !== null) {
		const raw = match[1] ?? match[2] ?? match[3] ?? "";
		if (raw.length > 0) out.push(unescapeLiteral(raw));
		match = pattern.exec(source);
	}
	return out;
}

/** 源码字面量 → 运行时字符串（只处理这几个转义，够覆盖界面文案） */
function unescapeLiteral(raw: string): string {
	return raw
		.replace(/\\n/g, "\n")
		.replace(/\\t/g, "\t")
		.replace(/\\"/g, '"')
		.replace(/\\'/g, "'")
		.replace(/\\\\/g, "\\");
}

function isChinese(text: string): boolean {
	return /[\u4e00-\u9fff]/.test(text);
}
