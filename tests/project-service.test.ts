import { describe, expect, it } from "vitest";
import { locateMarkers, sanitizeNoteName } from "../src/services/project-service";

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
