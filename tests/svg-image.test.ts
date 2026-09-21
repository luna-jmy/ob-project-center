import { describe, expect, it } from "vitest";
import {
	exportImageName,
	parseViewBoxSize,
	resolveAttachmentFolder,
} from "../src/panels/svg-image";

/*
 * Mermaid 预览的图片导出（用户口径 2026-09-21）。
 *
 * 只测能纯化的三条：文件名、附件目录推导、viewBox 解析。
 * 序列化与光栅化是 DOM 活（XMLSerializer / canvas / Image），而仓库对 DOM 层不写测试
 * （engine 是 node，没有 jsdom 与 canvas），所以那部分只能在实机上验——
 * 这里不假装覆盖它们。
 */
describe("导出图片的文件名", () => {
	it("stamps local date and time", () => {
		expect(exportImageName("甘特图", "svg", new Date(2026, 8, 21, 9, 5))).toBe(
			"甘特图-20260921-0905.svg",
		);
	});

	it("pads month / day / hour / minute to two digits", () => {
		// 月份是 0 基：0 = 一月
		expect(exportImageName("甘特图", "jpg", new Date(2026, 0, 2, 3, 4))).toBe(
			"甘特图-20260102-0304.jpg",
		);
	});
});

/*
 * 落点复用 Obsidian 自己的「附件默认位置」——参数写过的就不该让人重打一遍
 * （同用户口径：目录、标记这类东西在设置里配过一次就够）。
 */
describe("导出落点（Obsidian「附件默认位置」）", () => {
	it("treats an empty setting or / as the vault root", () => {
		expect(resolveAttachmentFolder(undefined, "100 Projects")).toBe("");
		expect(resolveAttachmentFolder("", "100 Projects")).toBe("");
		expect(resolveAttachmentFolder("   ", "100 Projects")).toBe("");
		expect(resolveAttachmentFolder("/", "100 Projects")).toBe("");
		expect(resolveAttachmentFolder(42, "100 Projects")).toBe("");
	});

	it("resolves ./ to the folder of the active note", () => {
		expect(resolveAttachmentFolder("./", "100 Projects/官网")).toBe("100 Projects/官网");
		// 没有活动笔记（视图带着焦点时就是这样）→ 退回 vault 根，而不是造一个 ./
		expect(resolveAttachmentFolder("./", null)).toBe("");
	});

	it("keeps a configured folder as a vault-relative path", () => {
		expect(resolveAttachmentFolder("assets", null)).toBe("assets");
		expect(resolveAttachmentFolder("/900 Assets/图/", null)).toBe("900 Assets/图");
	});
});

describe("viewBox 解析（尺寸取它和实测值里较大的那个）", () => {
	it("parses four numbers with space or comma separators", () => {
		expect(parseViewBoxSize("0 0 1200 600")).toEqual({ width: 1200, height: 600 });
		expect(parseViewBoxSize("0,0,1200,600")).toEqual({ width: 1200, height: 600 });
		expect(parseViewBoxSize("  0 0 1200 600  ")).toEqual({ width: 1200, height: 600 });
	});

	it("returns null for anything it cannot read as a size", () => {
		expect(parseViewBoxSize(null)).toBeNull();
		expect(parseViewBoxSize("")).toBeNull();
		expect(parseViewBoxSize("0 0 1200")).toBeNull();
		expect(parseViewBoxSize("0 0 0 600")).toBeNull();
		expect(parseViewBoxSize("0 0 wide tall")).toBeNull();
	});
});
