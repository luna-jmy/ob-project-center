import { describe, expect, it } from "vitest";
import {
	applyCoreTemplateSyntax,
	locateMarkers,
	missingOnly,
	quickProjectFolder,
	resolveParentFolder,
	sanitizeNoteName,
	templatePathCandidates,
	toVaultRelativePath,
} from "../src/services/project-service";

// `obsidian` 由 vitest.config.ts 的 alias 指向 tests/obsidian-stub.ts（该包无运行时入口）。

describe("标记块定位（SPEC F1.7 写入容错）", () => {
	const START = "%% gantt-builder:start %%";
	const END = "%% gantt-builder:end %%";
	const FENCE = "```";

	it("locates a well-formed block and returns the full replace range (markers included)", () => {
		const inner = `${FENCE}mermaid\ngantt\n${FENCE}`;
		const content = `# 项目\n\n${START}\n${inner}\n${END}\n\n## 资料\n`;
		const located = locateMarkers(content, START, END);
		if (!located.ok) throw new Error("should locate");
		expect(content.slice(located.startIndex, located.endIndex)).toBe(
			`${START}\n${inner}\n${END}`,
		);
	});

	it("fails without touching content when the start marker is missing", () => {
		const located = locateMarkers("# 项目\n\n正文\n", START, END);
		expect(located.ok).toBe(false);
		if (located.ok) throw new Error("should fail");
		expect(located.message).toContain("起始标记");
	});

	it("fails when the end marker is missing", () => {
		const located = locateMarkers(`# 项目\n${START}\n正文\n`, START, END);
		expect(located.ok).toBe(false);
		if (located.ok) throw new Error("should fail");
		expect(located.message).toContain("结束标记");
	});

	it("fails when the end marker appears before the start marker", () => {
		const located = locateMarkers(`${END}\n正文\n${START}\n`, START, END);
		expect(located.ok).toBe(false);
	});

	it("uses the first start marker and its nearest following end marker", () => {
		const content = `${START}\nA\n${END}\n\n${START}\nB\n${END}`;
		const located = locateMarkers(content, START, END);
		if (!located.ok) throw new Error("should locate");
		expect(content.slice(located.startIndex, located.endIndex)).toBe(`${START}\nA\n${END}`);
	});

	it("tolerates CRLF line endings", () => {
		const content = `# 项目\r\n\r\n${START}\r\n正文\r\n${END}\r\n`;
		const located = locateMarkers(content, START, END);
		expect(located.ok).toBe(true);
	});
});

describe("笔记文件名清洗（技能 compatibility.md：跨平台文件名）", () => {
	it("keeps Chinese, Latin and digits as-is", () => {
		expect(sanitizeNoteName("官网改版 v2")).toBe("官网改版 v2");
	});

	it("replaces path-illegal characters instead of silently dropping them", () => {
		expect(sanitizeNoteName("a/b:c*d?e")).toBe("a-b-c-d-e");
		expect(sanitizeNoteName('a<b>c|d"e')).toBe("a-b-c-d-e");
		expect(sanitizeNoteName("a\\b")).toBe("a-b");
	});

	it("strips trailing dots and spaces (Windows would trim them silently)", () => {
		expect(sanitizeNoteName("项目 v2.")).toBe("项目 v2");
		expect(sanitizeNoteName("项目 v2 . . ")).toBe("项目 v2");
	});

	it("collapses repeated whitespace", () => {
		expect(sanitizeNoteName("a   b")).toBe("a b");
	});

	it("escapes Windows reserved device names", () => {
		expect(sanitizeNoteName("CON")).toBe("_CON");
		expect(sanitizeNoteName("com1")).toBe("_com1");
		expect(sanitizeNoteName("LPT9")).toBe("_LPT9");
	});

	it("falls back to a default name when nothing usable remains", () => {
		expect(sanitizeNoteName("   ")).toBe("新项目");
		expect(sanitizeNoteName("...")).toBe("新项目");
		// 全是路径分隔符：清洗后只剩替换出来的连字符，但仍是非空合法文件名
		expect(sanitizeNoteName("///")).toBe("---");
	});

	it("strips characters that break wikilinks", () => {
		expect(sanitizeNoteName("笔记[1]^x")).toBe("笔记-1--x");
	});
});

/*
 * 套模板时的字段合并（用户口径 2026-09-20：「缺少的 frontmatter 添加到模板里，内容用用户的」）。
 * 锁的是「模板缺什么补什么」这一条：模板已给的值（含命令执行结果）一律不能盖掉。
 */
describe("套模板时的字段补全（模板缺什么补什么）", () => {
	it("keeps the template's own values", () => {
		expect(missingOnly({ status: "inbox", objective: "A" }, { status: "active" })).toEqual({
			objective: "A",
		});
	});

	it("fills keys the template does not have at all", () => {
		expect(missingOnly({ objective: "A" }, {})).toEqual({ objective: "A" });
	});

	it("fills keys the template left blank", () => {
		const merged = missingOnly({ start_date: "2026-01-01" }, { start_date: "", due_date: "" });
		expect(merged).toEqual({ start_date: "2026-01-01" });
	});

	it("treats false / 0 / empty array as real template values", () => {
		// long-term: false 是模板的真实取值（模板里就是常驻字段），不该被弹窗值盖掉
		expect(missingOnly({ "long-term": true, progress: 50 }, { "long-term": false })).toEqual({
			progress: 50,
		});
	});

	it("fills values that are still unexecuted template commands", () => {
		// 没装 Templater 时命令没被执行：留着当真的话状态会是一串命令
		const merged = missingOnly(
			{ status: "inbox" },
			{ status: '<% tp.system.suggester(["执行中"],["active"]) %>' },
		);
		expect(merged).toEqual({ status: "inbox" });
	});

	it("never schedules a delete for template keys", () => {
		// patch 里 null 表示「删除字段」，但新建的笔记里没什么可删的，更不该删模板给的字段
		expect(missingOnly({ priority: null, area: null }, { priority: "1" })).toEqual({});
	});

	it("works against the real TPL-Project frontmatter shape", () => {
		// 实战口径：模板已有 type/tags/long-term/status（后者是 suggester 命令），
		// 弹窗只该补模板留空的日期，并且不碰 tags 数组
		const template = {
			type: "project",
			status: '<% tp.system.suggester(["未开始"],["inbox"]) %>',
			priority: "",
			start_date: "",
			due_date: "",
			tags: ["project"],
			"long-term": false,
			"main-project": true,
		};
		const merged = missingOnly(
			{
				type: "project",
				status: "inbox",
				priority: null,
				start_date: "2026-01-01",
				due_date: "2026-02-01",
				tags: ["project"],
				"long-term": false,
				"main-project": false,
			},
			template,
		);
		expect(merged).toEqual({
			status: "inbox",
			start_date: "2026-01-01",
			due_date: "2026-02-01",
		});
	});
});

/*
 * 核心「模板」插件语法（`{{date:YYYYMM}}` 这类）。它只在手动插入模板时才被替换，
 * 而我们的笔记是插件创建的——不自己替换就会留成一串花括号。
 */
describe("模板里的核心「模板」插件占位符", () => {
	/** 只关心「按哪个格式去格式化」，具体日期值由宿主 moment 决定 */
	const withFormats = (seen: string[]) => (format: string) => {
		seen.push(format);
		return `<${format}>`;
	};

	it("replaces {{title}} with the note name", () => {
		const seen: string[] = [];
		expect(applyCoreTemplateSyntax("# {{title}}", { title: "官网改版", format: withFormats(seen) })).toBe(
			"# 官网改版",
		);
		expect(seen).toEqual([]);
	});

	it("uses the format given in the placeholder", () => {
		const seen: string[] = [];
		expect(
			applyCoreTemplateSyntax('project-id: "{{date:YYYYMM}}"', {
				title: "a",
				format: withFormats(seen),
			}),
		).toBe('project-id: "<YYYYMM>"');
		expect(seen).toEqual(["YYYYMM"]);
	});

	it("falls back to the core plugin's default formats", () => {
		const seen: string[] = [];
		applyCoreTemplateSyntax("{{date}} {{time}}", { title: "a", format: withFormats(seen) });
		expect(seen).toEqual(["YYYY-MM-DD", "HH:mm"]);
	});

	it("leaves unrelated braces alone", () => {
		const seen: string[] = [];
		const content = "{{other}} {{ 手写的 }} <% tp.file.title %>";
		expect(applyCoreTemplateSyntax(content, { title: "a", format: withFormats(seen) })).toBe(
			content,
		);
	});
});

/*
 * 用户报的 bug（2026-09-20）：设置里填 `900 Assets/910 Templates/TPL-Project`
 * （从 Obsidian 复制来的，没有 `.md`）时报「找不到模板笔记」。
 *
 * 复制出来的路径不止一种形态，这里锁住能收敛的那几种——但也**只**收敛这几种，
 * 不做模糊匹配（找不到就该报错，不能猜一个相近的文件当模板）。
 */
describe("模板路径清洗（从 Obsidian 复制来的路径）", () => {
	it("adds the .md extension when the copied path omits it", () => {
		expect(templatePathCandidates("900 Assets/910 Templates/TPL-Project")).toEqual([
			"900 Assets/910 Templates/TPL-Project",
			"900 Assets/910 Templates/TPL-Project.md",
		]);
	});

	it("does not double the extension when it is already there", () => {
		expect(templatePathCandidates("templates/TPL-Project.md")).toEqual([
			"templates/TPL-Project.md",
		]);
	});

	it("strips the vault absolute path prefix (desktop copy gives an absolute path)", () => {
		expect(
			toVaultRelativePath("D:\\vault\\900 Assets\\910 Templates\\TPL-Project.md", "D:\\vault"),
		).toBe("900 Assets/910 Templates/TPL-Project.md");
		// Windows 路径大小写不敏感
		expect(toVaultRelativePath("d:/VAULT/templates/TPL.md", "D:/vault")).toBe(
			"templates/TPL.md",
		);
	});

	it("does not strip a sibling folder that merely shares the prefix", () => {
		// 前缀必须落在目录边界上：D:/vault2 不是 D:/vault 里面的东西
		expect(toVaultRelativePath("D:/vault2/templates/TPL.md", "D:/vault")).toBe(
			"D:/vault2/templates/TPL.md",
		);
	});

	it("unwraps a copied wikilink", () => {
		expect(toVaultRelativePath("[[TPL-Project]]")).toBe("TPL-Project");
		expect(toVaultRelativePath("![[TPL-Project|模板]]")).toBe("TPL-Project");
	});

	it("tolerates quotes and surrounding whitespace", () => {
		expect(toVaultRelativePath('  "templates/TPL.md"  ')).toBe("templates/TPL.md");
	});

	it("returns no candidate for an empty value", () => {
		expect(templatePathCandidates("")).toEqual([]);
		expect(templatePathCandidates("   ")).toEqual([]);
	});
});

/*
 * 上级目录 = 扫描目录（下拉选的）+ 可选子文件夹。
 * 参数里写过扫描目录就不该让用户重打，而子文件夹这一格保住「放进中间层目录」的用法。
 */
describe("新建项目的上级目录（扫描目录 + 子文件夹）", () => {
	it("uses the scan folder alone when the subfolder is empty", () => {
		expect(resolveParentFolder("100 Projects", "")).toBe("100 Projects");
	});

	it("joins the subfolder under the selected scan folder", () => {
		expect(resolveParentFolder("100 Projects", "2026工作项目")).toBe("100 Projects/2026工作项目");
	});

	it("keeps multi-level subfolders", () => {
		expect(resolveParentFolder("100 Projects", "2026/上半年")).toBe("100 Projects/2026/上半年");
	});

	it("falls back to the subfolder when no scan folder is configured", () => {
		expect(resolveParentFolder("", "某处/项目")).toBe("某处/项目");
		expect(resolveParentFolder("", "")).toBe("");
	});

	it("tolerates surrounding slashes and whitespace in both fields", () => {
		expect(resolveParentFolder("/100 Projects/", " /2026工作项目/ ")).toBe(
			"100 Projects/2026工作项目",
		);
	});
});

/*
 * 快速项目落点（用户口径 2026-09-20）：新建的快速项目放进「快速项目」文件夹，
 * 而不是扫描目录根层——与读取侧的 isQuickProject 保持同一口径。
 */
describe("快速项目落点（标记文件夹）", () => {
	it("puts it in the marker folder under the parent", () => {
		expect(quickProjectFolder("100 Projects", "快速项目")).toBe("100 Projects/快速项目");
	});

	it("does not nest twice when the parent already is the marker folder", () => {
		expect(quickProjectFolder("100 Projects/快速项目", "快速项目")).toBe("100 Projects/快速项目");
	});

	it("falls back to the parent when the marker is empty", () => {
		expect(quickProjectFolder("100 Projects", "  ")).toBe("100 Projects");
	});

	it("uses the marker as a top-level folder when there is no parent", () => {
		expect(quickProjectFolder("", "快速项目")).toBe("快速项目");
	});

	it("tolerates surrounding slashes and whitespace", () => {
		expect(quickProjectFolder("/100 Projects/", " 快速项目 ")).toBe("100 Projects/快速项目");
	});
});
