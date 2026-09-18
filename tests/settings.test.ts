import { describe, expect, it } from "vitest";
import {
	DEFAULT_FIELD_MAPPING,
	DEFAULT_SETTINGS,
	PROJECT_STATUSES,
	STATUS_CHINESE_ALIASES,
	SETTINGS_VERSION,
} from "../src/types";

/**
 * Milestone 0 冒烟测试：设置骨架与 TPL-Project 模板现状一致（SPEC §5.2）。
 * 规范化层/筛选管道/分组逻辑的 TDD 用例随对应里程碑落地。
 */
describe("default settings (milestone 0)", () => {
	it("field mapping matches TPL-Project template", () => {
		expect(DEFAULT_FIELD_MAPPING.type).toBe("type");
		expect(DEFAULT_FIELD_MAPPING.status).toBe("status");
		expect(DEFAULT_FIELD_MAPPING.priority).toBe("priority");
		expect(DEFAULT_FIELD_MAPPING.startDate).toBe("start_date");
		expect(DEFAULT_FIELD_MAPPING.dueDate).toBe("due_date");
		expect(DEFAULT_FIELD_MAPPING.endDateFallback).toBe("end_date");
		expect(DEFAULT_FIELD_MAPPING.completionDate).toBe("completion_date");
		expect(DEFAULT_FIELD_MAPPING.projectLeader).toBe("project-leader");
		expect(DEFAULT_FIELD_MAPPING.projectMembers).toBe("project-members");
		expect(DEFAULT_FIELD_MAPPING.longTerm).toBe("long-term");
		expect(DEFAULT_FIELD_MAPPING.mainProject).toBe("main-project");
		expect(DEFAULT_FIELD_MAPPING.projectId).toBe("project-id");
		expect(DEFAULT_FIELD_MAPPING.identifyTag).toBe("project");
	});

	it("scan folders default to 100 Projects (existing script behavior)", () => {
		expect(DEFAULT_SETTINGS.scanFolders).toEqual(["100 Projects"]);
	});

	it("quick project marker keeps existing hard-coded value, now configurable", () => {
		expect(DEFAULT_SETTINGS.quickProjectMarker).toBe("快速项目");
	});

	it("does not hardcode the obsidian config dir in excluded folders", () => {
		// 配置目录运行时由 Vault#configDir 并入（obsidianmd/hardcoded-config-path）：
		// 断言默认排除项中不存在任何指向 obsidian 配置目录的硬编码
		expect(
			DEFAULT_SETTINGS.excludedFolders.some((f) => f.includes("obsidian")),
		).toBe(false);
	});

	it("ships with current settings version", () => {
		expect(DEFAULT_SETTINGS.version).toBe(SETTINGS_VERSION);
	});

	it("status enum aligns with template suggester order", () => {
		expect(PROJECT_STATUSES).toEqual([
			"inbox",
			"draft",
			"active",
			"on-hold",
			"completed",
			"cancelled",
			"archived",
		]);
	});

	it("chinese aliases map to canonical statuses", () => {
		expect(STATUS_CHINESE_ALIASES["执行中"]).toBe("active");
		expect(STATUS_CHINESE_ALIASES["完成"]).toBe("completed");
		expect(STATUS_CHINESE_ALIASES["取消"]).toBe("cancelled");
	});
});
