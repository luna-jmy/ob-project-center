import { describe, expect, it } from "vitest";
import { groupProjects } from "../src/services/grouping-service";
import {
	applyManualOrder,
	applyManualOrderIfNeeded,
	EMPTY_MANUAL_ORDER,
	mergeVisibleOrder,
	projectOrderKey,
	reorderByKey,
} from "../src/services/manual-order";
import { DEFAULT_SETTINGS } from "../src/types";
import { projectItem } from "./fixtures";

const projects = [
	projectItem({ name: "a", path: "100 Projects/甲/a.md", dueDate: "2026-01-01" }),
	projectItem({ name: "b", path: "100 Projects/乙/b.md", dueDate: "2026-12-01" }),
	projectItem({ name: "c", path: "100 Projects/丙/c.md", dueDate: "2026-06-01" }),
];

/*
 * 甘特侧栏的拖动只看得见「上了甘特图」的项目，被跳过的（已取消 / 缺日期）
 * 不能因为这次拖动而掉到组尾——它们的位置必须原地钉住。
 */
describe("mergeVisibleOrder — 可见顺序并回完整序列", () => {
	it("reorders only the visible slots and leaves the skipped projects pinned", () => {
		// 完整：X（缺日期，甘特看不到）、A、B、C —— 甘特里把 C 拖到了最前
		const merged = mergeVisibleOrder(["X", "A", "B", "C"], ["C", "A", "B"]);
		expect(merged).toEqual(["X", "C", "A", "B"]);
	});

	it("keeps skipped projects pinned in their own slots even when interleaved", () => {
		// 完整 [A, X2, B, X4, C]，甘特里把 C 拖到 B 前面 → 两个可见槽位对调，
		// 被跳过的 X2 / X4 原地不动
		const merged = mergeVisibleOrder(["A", "X2", "B", "X4", "C"], ["C", "B"]);
		expect(merged).toEqual(["A", "X2", "C", "X4", "B"]);
	});

	it("is a no-op when the visible order already matches", () => {
		const full = ["X", "A", "B"];
		expect(mergeVisibleOrder(full, ["A", "B"])).toEqual(full);
	});

	it("falls back to the visible order when the full list is unknown", () => {
		expect(mergeVisibleOrder([], ["B", "A"])).toEqual(["B", "A"]);
	});

	it("ignores an empty visible list", () => {
		expect(mergeVisibleOrder(["A", "B"], [])).toEqual(["A", "B"]);
	});
});

describe("reorderByKey — 基础重排语义", () => {
	it("orders by the recorded keys", () => {
		const result = reorderByKey(["c", "a", "b"], projects, (p) => p.file.name);
		expect(result.map((p) => p.file.name)).toEqual(["c", "a", "b"]);
	});

	it("pushes unrecorded items after recorded ones, keeping their relative order", () => {
		// b 没被记录：应排在 a、c 之后，且只有一个时的相对位置无所谓——关键是「不插队」
		const result = reorderByKey(["c", "a"], projects, (p) => p.file.name);
		expect(result.map((p) => p.file.name)).toEqual(["c", "a", "b"]);
	});

	it("keeps several unrecorded items in their input order (stable sort)", () => {
		const four = [...projects, projectItem({ name: "d", path: "100 Projects/丁/d.md" })];
		const result = reorderByKey(["b"], four, (p) => p.file.name);
		expect(result.map((p) => p.file.name)).toEqual(["b", "a", "c", "d"]);
	});

	it("ignores recorded keys that no longer exist (renamed / filtered-out projects)", () => {
		const result = reorderByKey(["gone", "b", "a"], projects, (p) => p.file.name);
		expect(result.map((p) => p.file.name)).toEqual(["b", "a", "c"]);
	});

	it("returns a copy when there is nothing recorded (never mutates the input)", () => {
		const result = reorderByKey([], projects, (p) => p.file.name);
		expect(result).not.toBe(projects);
		expect(result.map((p) => p.file.name)).toEqual(["a", "b", "c"]);
	});
});

describe("applyManualOrder — 分组与组内项目", () => {
	const grouped = groupProjects(projects, DEFAULT_SETTINGS);

	it("reorders groups by their keys", () => {
		const order = {
			groups: { folder: ["100 Projects/丙", "100 Projects/甲", "100 Projects/乙"] },
			projects: {},
		};
		const result = applyManualOrder(grouped, "folder", order);
		expect(result.normalGroups.map((g) => g.key)).toEqual([
			"100 Projects/丙",
			"100 Projects/甲",
			"100 Projects/乙",
		]);
	});

	it("keying is per grouping mode, so a folder path can't be confused with an area value", () => {
		const order = {
			groups: { folder: ["100 Projects/丙", "100 Projects/甲", "100 Projects/乙"] },
			projects: {},
		};
		// objective 模式没有记录 → 保持原顺序
		const byObjective = applyManualOrder(grouped, "objective", order);
		expect(byObjective.normalGroups.map((g) => g.key)).not.toEqual([
			"100 Projects/丙",
			"100 Projects/甲",
			"100 Projects/乙",
		]);
	});

	it("reorders projects inside a group with the mode-prefixed key", () => {
		const multi = [
			projectItem({ name: "p1", path: "100 Projects/组/p1.md" }),
			projectItem({ name: "p2", path: "100 Projects/组/p2.md" }),
			projectItem({ name: "p3", path: "100 Projects/组/p3.md" }),
		];
		const source = groupProjects(multi, DEFAULT_SETTINGS);
		const order = {
			groups: {},
			projects: {
				[projectOrderKey("folder", "100 Projects/组")]: [
					"100 Projects/组/p3.md",
					"100 Projects/组/p1.md",
					"100 Projects/组/p2.md",
				],
			},
		};
		const result = applyManualOrder(source, "folder", order);
		expect(result.normalGroups[0]?.projects.map((p) => p.file.name)).toEqual(["p3", "p1", "p2"]);
	});

	it("never drops or duplicates projects while reordering", () => {
		const order = {
			groups: { folder: ["100 Projects/乙"] },
			projects: { [projectOrderKey("folder", "100 Projects/乙")]: ["100 Projects/乙/b.md"] },
		};
		const result = applyManualOrder(grouped, "folder", order);
		const names = result.normalGroups.flatMap((g) => g.projects.map((p) => p.file.name)).sort();
		expect(names).toEqual(["a", "b", "c"]);
	});

	it("does not mutate the input grouping result", () => {
		const before = grouped.normalGroups.map((g) => g.key);
		applyManualOrder(grouped, "folder", { groups: { folder: [...before].reverse() }, projects: {} });
		expect(grouped.normalGroups.map((g) => g.key)).toEqual(before);
	});
});

describe("applyManualOrderIfNeeded — 只在「手动排序」档生效", () => {
	const grouped = groupProjects(projects, DEFAULT_SETTINGS);
	const order = {
		groups: { folder: ["100 Projects/丙", "100 Projects/甲", "100 Projects/乙"] },
		projects: {},
	};
	const manualKeys = ["100 Projects/丙", "100 Projects/甲", "100 Projects/乙"];

	it("applies the order when the sort mode is manual", () => {
		const result = applyManualOrderIfNeeded(grouped, "folder", "manual", order);
		expect(result.normalGroups.map((g) => g.key)).toEqual(manualKeys);
	});

	it("leaves other sort modes untouched (otherwise one drag would hijack 截止日排序)", () => {
		for (const mode of ["due-asc", "name", "priority"] as const) {
			const result = applyManualOrderIfNeeded(grouped, "folder", mode, order);
			expect(result.normalGroups.map((g) => g.key)).not.toEqual(manualKeys);
		}
	});

	it("is a no-op with an empty order record", () => {
		const result = applyManualOrderIfNeeded(grouped, "folder", "manual", EMPTY_MANUAL_ORDER);
		expect(result.normalGroups.map((g) => g.key)).toEqual(grouped.normalGroups.map((g) => g.key));
	});
});
