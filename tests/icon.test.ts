import { describe, expect, it } from "vitest";
import { ICON_CANDIDATES, pickViewIcon } from "../src/utils/icon";

/*
 * 图标选名的回归测试（用户口径 2026-09-20：换掉与「白板」撞脸的图标）。
 *
 * 这里锁住两件事：
 * 1. 候选清单里不能再出现 Obsidian 内置「白板 Canvas」的 `layout-dashboard`——那正是要躲开的撞脸；
 * 2. 首选名在当前 Obsidian 里不存在时要能退档，而不是画出一个空白图标。
 */
describe("插件图标选名", () => {
	it("picks the first candidate the environment actually registers", () => {
		expect(pickViewIcon(["lucide-calendar-range", "lucide-kanban"])).toBe("calendar-range");
	});

	it("strips the lucide- prefix before comparing", () => {
		expect(pickViewIcon(["lucide-gantt-chart"])).toBe("gantt-chart");
	});

	it("keeps the preferred icon when it is registered", () => {
		expect(pickViewIcon(["lucide-gantt-chart", "lucide-calendar-range"])).toBe("gantt-chart");
	});

	/* 用户选定 gantt-chart（2026-09-20）：把它钉住——重排候选链会直接换掉插件图标 */
	it("pins the chosen icon name", () => {
		expect(ICON_CANDIDATES[0]).toBe("gantt-chart");
	});

	it("falls back to the top candidate when none of them are registered", () => {
		expect(pickViewIcon(["lucide-star", "lucide-folder"])).toBe(ICON_CANDIDATES[0]);
	});

	it("does not fall back to the Canvas whiteboard icon we are moving away from", () => {
		expect(ICON_CANDIDATES).not.toContain("layout-dashboard");
		expect(pickViewIcon(["lucide-layout-dashboard"])).not.toBe("layout-dashboard");
	});
});
