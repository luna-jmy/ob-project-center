import { describe, expect, it } from "vitest";
import { toggleListValue } from "../src/modals/suggestion-fields";

/*
 * 多值字段「点一下标签」的语义（用户口径 2026-09-21）。
 *
 * 编辑弹窗与新建弹窗共用这一份。抽成纯函数就是为了能测：标签的选中态与输入框内容
 * 都由它推导，写反了会变成「点一下追加出两个」这种只在界面上看得见的错。
 */
describe("toggleListValue（多值字段标签的点选语义）", () => {
	it("appends a value that is not selected yet", () => {
		expect(toggleListValue([], "市场")).toEqual(["市场"]);
		expect(toggleListValue(["市场"], "运营")).toEqual(["市场", "运营"]);
	});

	it("removes a value that is already selected", () => {
		expect(toggleListValue(["市场", "运营"], "市场")).toEqual(["运营"]);
		expect(toggleListValue(["市场"], "市场")).toEqual([]);
	});

	it("does not touch the input array (callers keep their own state)", () => {
		const original = ["市场"];
		const next = toggleListValue(original, "运营");
		expect(original).toEqual(["市场"]);
		expect(next).not.toBe(original);
	});

	it("matches values exactly — '市场部' and '市场' are different values", () => {
		// 候选机制存在的理由就是不让这两个并存，所以判定不能做包含匹配
		expect(toggleListValue(["市场"], "市场部")).toEqual(["市场", "市场部"]);
	});
});
