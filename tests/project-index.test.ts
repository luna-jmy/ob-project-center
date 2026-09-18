import { beforeEach, describe, expect, it } from "vitest";
import { ProjectIndex } from "../src/services/project-index";
import { DEFAULT_SETTINGS, ProjectMasterSettings } from "../src/types";

interface FakeFile {
	path: string;
	name: string;
	folder: string;
}

function file(path: string): FakeFile {
	const segments = path.split("/");
	const name = segments[segments.length - 1].replace(/\.md$/, "");
	const folder = segments.slice(0, -1).join("/");
	return { path, name, folder };
}

function fm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { type: "project", status: "active", start_date: "2026-09-01", ...overrides };
}

function makeIndex(
	files: FakeFile[],
	caches: Record<string, Record<string, unknown> | null>,
	settings: ProjectMasterSettings = DEFAULT_SETTINGS,
): ProjectIndex {
	return new ProjectIndex(
		files,
		(path) => caches[path] ?? null,
		settings,
	);
}

describe("ProjectIndex — 扫描范围（SPEC §2.1/§5.1）", () => {
	it("indexes only type:project notes inside scan folders", () => {
		const index = makeIndex(
			[
				file("100 Projects/A/p1.md"),
				file("100 Projects/A/p2.md"),
				file("200 Other/p3.md"),
			],
			{
				"100 Projects/A/p1.md": fm(),
				"100 Projects/A/p2.md": { type: "meeting" },
				"200 Other/p3.md": fm(),
			},
		);
		index.rebuild();
		const paths = index.getAll().map((item) => item.file.path);
		expect(paths).toEqual(["100 Projects/A/p1.md"]);
	});

	it("supports multiple scan folders", () => {
		const settings = { ...DEFAULT_SETTINGS, scanFolders: ["100 Projects", "300 Work"] };
		const index = makeIndex(
			[file("100 Projects/a.md"), file("300 Work/b.md"), file("400 Nope/c.md")],
			{
				"100 Projects/a.md": fm(),
				"300 Work/b.md": fm(),
				"400 Nope/c.md": fm(),
			},
			settings,
		);
		index.rebuild();
		expect(index.getAll()).toHaveLength(2);
	});

	it("excludes excluded folders by path prefix", () => {
		const settings = { ...DEFAULT_SETTINGS, excludedFolders: ["100 Projects/templates"] };
		const index = makeIndex(
			[
				file("100 Projects/templates/t1.md"),
				file("100 Projects/templates/sub/t2.md"),
				file("100 Projects/real/p.md"),
			],
			{
				"100 Projects/templates/t1.md": fm(),
				"100 Projects/templates/sub/t2.md": fm(),
				"100 Projects/real/p.md": fm(),
			},
			settings,
		);
		index.rebuild();
		expect(index.getAll().map((i) => i.file.path)).toEqual([
			"100 Projects/real/p.md",
		]);
	});

	it("keeps root-level project notes (quick projects live at scan root)", () => {
		const index = makeIndex(
			[file("100 Projects/quick.md"), file("100 Projects/Deep/nested.md")],
			{
				"100 Projects/quick.md": fm(),
				"100 Projects/Deep/nested.md": fm(),
			},
		);
		index.rebuild();
		expect(index.getAll()).toHaveLength(2);
	});
});

describe("ProjectIndex — 增量更新（SPEC §3.1）", () => {
	let caches: Record<string, Record<string, unknown> | null>;

	beforeEach(() => {
		caches = { "100 Projects/A/p1.md": fm() };
	});

	it("rebuild is idempotent (no duplicates)", () => {
		const files = [file("100 Projects/A/p1.md")];
		const index = makeIndex(files, caches);
		index.rebuild();
		index.rebuild();
		expect(index.getAll()).toHaveLength(1);
	});

	it("upserts on change (metadata edited → item refreshes)", () => {
		const files = [file("100 Projects/A/p1.md")];
		const index = makeIndex(files, caches);
		index.rebuild();

		caches["100 Projects/A/p1.md"] = fm({ status: "completed" });
		const updated = index.update("100 Projects/A/p1.md");
		expect(updated).toBe(true);
		expect(index.getAll()[0]?.status).toBe("completed");
		expect(index.getAll()).toHaveLength(1);
	});

	it("demotes a note that stops being a project (type removed)", () => {
		const files = [file("100 Projects/A/p1.md")];
		const index = makeIndex(files, caches);
		index.rebuild();

		caches["100 Projects/A/p1.md"] = { status: "active" };
		index.update("100 Projects/A/p1.md");
		expect(index.getAll()).toHaveLength(0);
	});

	it("promotes a note that becomes a project", () => {
		const files = [file("100 Projects/A/p1.md"), file("100 Projects/A/new.md")];
		caches["100 Projects/A/new.md"] = null;
		const index = makeIndex(files, caches);
		index.rebuild();
		expect(index.getAll()).toHaveLength(1);

		caches["100 Projects/A/new.md"] = fm();
		index.update("100 Projects/A/new.md");
		expect(index.getAll()).toHaveLength(2);
	});

	it("remove drops the note from the index", () => {
		const files = [file("100 Projects/A/p1.md")];
		const index = makeIndex(files, caches);
		index.rebuild();

		index.remove("100 Projects/A/p1.md");
		expect(index.getAll()).toHaveLength(0);
	});

	it("ignores updates for paths outside scan folders or in excluded folders", () => {
		const files = [file("100 Projects/A/p1.md")];
		const index = makeIndex(files, caches);
		index.rebuild();

		caches["200 Other/x.md"] = fm();
		expect(index.update("200 Other/x.md")).toBe(false);
		expect(index.getAll()).toHaveLength(1);
	});
});

describe("ProjectIndex — issues 透传（SPEC §2.3）", () => {
	it("collects data issues per file for UI repair hints", () => {
		const index = makeIndex(
			[file("100 Projects/A/bad.md")],
			{
				"100 Projects/A/bad.md": fm({
					start_date: "2026-02-30",
					status: "乱写",
				}),
			},
		);
		index.rebuild();
		const issues = index.getIssues()["100 Projects/A/bad.md"] ?? [];
		expect(issues.some((i) => i.reason === "invalid-date")).toBe(true);
		expect(issues.some((i) => i.reason === "unknown-status")).toBe(true);
	});
});
