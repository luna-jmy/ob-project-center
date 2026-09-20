import { describe, expect, it } from "vitest";
import { migrateSettings, withConfigDir } from "../src/settings-migration";
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "../src/types";

describe("设置迁移 — 幂等与容错（SPEC §5.5/§8）", () => {
	it("fills in defaults for every missing field (v1 → v2 upgrade path)", () => {
		const migrated = migrateSettings({ version: 1, scanFolders: ["Projects"] });
		expect(migrated.version).toBe(SETTINGS_VERSION);
		expect(migrated.scanFolders).toEqual(["Projects"]);
		expect(migrated.dateFallbackDays).toBe(7);
		expect(migrated.hideCancelledInGantt).toBe(true);
		expect(migrated.mermaidMarkerStart).toBe(DEFAULT_SETTINGS.mermaidMarkerStart);
		expect(migrated.fieldMapping.dueDate).toBe("due_date");
	});

	it("is idempotent (running twice equals running once)", () => {
		const once = migrateSettings({ version: 1, scanFolders: ["A"], defaultZoom: "week" });
		const twice = migrateSettings(once);
		expect(twice).toEqual(once);
	});

	it("never throws and falls back per field on garbage input", () => {
		const migrated = migrateSettings({
			version: "not-a-number",
			scanFolders: "not-an-array",
			dateFallbackDays: -5,
			maxNotesPerProject: "many",
			defaultGrouping: "nope",
			statusOrder: 42,
			fieldMapping: "broken",
			statusAliases: [1, 2, 3],
		});
		expect(migrated.version).toBe(SETTINGS_VERSION);
		expect(migrated.scanFolders).toEqual(DEFAULT_SETTINGS.scanFolders);
		expect(migrated.dateFallbackDays).toBe(7);
		expect(migrated.maxNotesPerProject).toBe(5);
		expect(migrated.defaultGrouping).toBe("folder");
		expect(migrated.statusOrder).toEqual(DEFAULT_SETTINGS.statusOrder);
		expect(migrated.fieldMapping).toEqual(DEFAULT_SETTINGS.fieldMapping);
		expect(migrated.statusAliases).toEqual(DEFAULT_SETTINGS.statusAliases);
	});

	it("survives null / undefined / non-object input", () => {
		expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(migrateSettings("garbage")).toEqual(DEFAULT_SETTINGS);
		expect(migrateSettings([1, 2, 3])).toEqual(DEFAULT_SETTINGS);
	});

	it("keeps the user's data for fields that are valid", () => {
		const migrated = migrateSettings({
			scanFolders: ["100 Projects", "300 Work"],
			quickProjectMarker: "闪电",
			chineseAliasCompat: false,
			dateFallback: "mark-invalid",
			defaultSort: "priority",
			maxNotesPerProject: 0,
		});
		expect(migrated.scanFolders).toEqual(["100 Projects", "300 Work"]);
		expect(migrated.quickProjectMarker).toBe("闪电");
		expect(migrated.chineseAliasCompat).toBe(false);
		expect(migrated.dateFallback).toBe("mark-invalid");
		expect(migrated.defaultSort).toBe("priority");
		expect(migrated.maxNotesPerProject).toBe(0);
	});

	it("defaults the year-filter preference to the current year and validates the enum", () => {
		expect(migrateSettings(null).defaultYearFilter).toBe("current");
		expect(migrateSettings({ defaultYearFilter: "none" }).defaultYearFilter).toBe("none");
		expect(migrateSettings({ defaultYearFilter: "bogus" }).defaultYearFilter).toBe("current");
	});

	it("dedupes scan folders and drops blank entries", () => {
		const migrated = migrateSettings({ scanFolders: ["A", " A ", "", "B"] });
		expect(migrated.scanFolders).toEqual(["A", "B"]);
	});

	it("cleans broken field mapping entries individually", () => {
		const migrated = migrateSettings({
			fieldMapping: { dueDate: "", startDate: "开始", bogus: "x" },
		});
		expect(migrated.fieldMapping.startDate).toBe("开始");
		// 空字符串回退默认，其余逻辑字段补齐
		expect(migrated.fieldMapping.dueDate).toBe("due_date");
		expect(migrated.fieldMapping.endDateFallback).toBe("end_date");
	});

	it("drops alias entries pointing at unknown statuses", () => {
		const migrated = migrateSettings({
			statusAliases: { 进行中: "active", 胡写: "whatever" },
		});
		expect(migrated.statusAliases).toEqual({ 进行中: "active" });
	});

	it("filters invalid statuses out of the suggester order and replaces an empty result", () => {
		const migrated = migrateSettings({ statusOrder: ["active", "bogus", "active", "draft"] });
		expect(migrated.statusOrder).toEqual(["active", "draft"]);
		expect(migrateSettings({ statusOrder: ["bogus"] }).statusOrder).toEqual(
			DEFAULT_SETTINGS.statusOrder,
		);
	});

	it("does not share mutable default objects between calls", () => {
		const a = migrateSettings(null);
		a.scanFolders.push("mutated");
		a.fieldMapping.dueDate = "mutated";
		const b = migrateSettings(null);
		expect(b.scanFolders).toEqual(DEFAULT_SETTINGS.scanFolders);
		expect(b.fieldMapping.dueDate).toBe("due_date");
		expect(DEFAULT_SETTINGS.fieldMapping.dueDate).toBe("due_date");
	});
});

describe("设置迁移 — 运行时配置目录并入（不硬编码配置目录名）", () => {
	// 注意：这里刻意用假名字而不是真实的配置目录名——
	// 真实目录名由 Vault#configDir 在运行时提供，测试写死它反而会固化错误假设。
	const FAKE_CONFIG_DIR = "custom-config-dir";

	it("appends the actual config dir", () => {
		const result = withConfigDir(migrateSettings(null), FAKE_CONFIG_DIR);
		expect(result.excludedFolders).toContain(FAKE_CONFIG_DIR);
	});

	it("does not duplicate an already-present config dir (idempotent)", () => {
		const once = withConfigDir(migrateSettings(null), FAKE_CONFIG_DIR);
		const twice = withConfigDir(once, FAKE_CONFIG_DIR);
		expect(twice.excludedFolders.filter((f) => f === FAKE_CONFIG_DIR)).toHaveLength(1);
	});

	it("ignores an empty config dir", () => {
		const result = withConfigDir(migrateSettings(null), "");
		expect(result.excludedFolders).toEqual(DEFAULT_SETTINGS.excludedFolders);
	});
});
