import { describe, expect, it } from "vitest";
import { DEFAULT_FIELD_MAPPING, fieldCopy } from "../src/types";

/*
 * 字段映射在设置页上的说法：只讲人话，不讲代码（用户口径 2026-09-20）。
 *
 * 原来设置页直接把逻辑字段名当标题印出来（completionDate 这种），用户既不知道它对应
 * 模板里的哪个字段，也不知道该往 frontmatter 写什么。这组用例把「设置页不会再漏出
 * 逻辑字段名」这条界面要求固定下来。
 */
describe("字段映射的设置页文案", () => {
	const keys = Object.keys(DEFAULT_FIELD_MAPPING) as (keyof typeof DEFAULT_FIELD_MAPPING)[];

	it("covers every mapped field", () => {
		// 覆盖性由类型保证（Record<keyof FieldMappingConfig, …>），这里守住内容非空
		for (const key of keys) {
			const { label, desc } = fieldCopy(key);
			expect(label.length, key).toBeGreaterThan(0);
			expect(desc.length, key).toBeGreaterThan(0);
		}
	});

	it("shows 项目完成日期 for completionDate instead of the code-side name", () => {
		expect(fieldCopy("completionDate").label).toBe("项目完成日期");
		expect(fieldCopy("completionDate").label).not.toContain("completionDate");
		expect(fieldCopy("completionDate").label).not.toContain("completion_date");
	});

	it("never leaks a code-side key name into a label", () => {
		for (const key of keys) {
			const { label, desc } = fieldCopy(key);
			// 逻辑键名是 camelCase（startDate / projectMembers…），标签里不该出现这种写法
			expect(label).not.toMatch(/[a-z][A-Z]/);
			expect(label.toLowerCase()).not.toBe(key.toLowerCase());
			expect(label.length).toBeGreaterThan(0);
			expect(desc.length).toBeGreaterThan(0);
		}
	});

	it("keeps the frontmatter field name in the default value, not in the label", () => {
		// 输入框里仍然是物理字段名——那正是用户要照着写进笔记 frontmatter 的东西
		expect(DEFAULT_FIELD_MAPPING.completionDate).toBe("completion_date");
		expect(DEFAULT_FIELD_MAPPING.projectLeader).toBe("project-leader");
	});
});
