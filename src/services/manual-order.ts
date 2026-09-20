import { GroupingResult } from "./grouping-service";
import { GroupingMode, ProjectItem, SortMode } from "../types";

/**
 * 手动排序（用户要求 2026-09-20）—— 纯函数。
 *
 * 用户在面板上拖动分组或组内项目后，顺序记进设置：分组顺序按**分组模式**分别记
 * （folder 的 key 是文件夹路径、objective/area 的 key 是值，混在一起会互相污染），
 * 组内项目顺序按 `${模式}::${分组 key}` 记。
 *
 * 三条口径（都在测试里固化）：
 * 1. **只有排序档为 `manual` 时才生效**——否则用户按截止日排序、拖动一次就再也回不去了；
 * 2. 记录里没有的项排在**已记录项之后**，并保持它们原本的相对顺序（稳定排序兜底），
 *    这样「新加进来的项目」「新出现的分组」不会插到用户手动排好的序列中间；
 * 3. 记录里有、但当前数据里已经没有的 key 直接忽略（被筛选掉/改名/删除都是常态）。
 */

export interface ManualOrder {
	/** 分组模式 → 分组 key 顺序 */
	groups: Record<string, string[]>;
	/** `${模式}::${分组 key}` → 项目路径顺序 */
	projects: Record<string, string[]>;
}

export const EMPTY_MANUAL_ORDER: ManualOrder = { groups: {}, projects: {} };

/** 组内项目顺序的存储键（模式前缀避免 folder 路径与 area 值撞车） */
export function projectOrderKey(mode: GroupingMode, groupKey: string): string {
	return `${mode}::${groupKey}`;
}

/** 按给定顺序重排；未记录的项排在后面并保持原相对顺序 */
export function reorderByKey<T>(
	order: readonly string[],
	items: readonly T[],
	keyOf: (item: T) => string,
): T[] {
	if (order.length === 0) return [...items];
	const rank = new Map<string, number>();
	order.forEach((key, index) => {
		if (!rank.has(key)) rank.set(key, index);
	});
	// 未记录的项共用一个哨兵值，sort 的稳定性保证它们维持入参相对顺序
	const unrecorded = Number.MAX_SAFE_INTEGER;
	return [...items].sort((a, b) => {
		const ra = rank.get(keyOf(a)) ?? unrecorded;
		const rb = rank.get(keyOf(b)) ?? unrecorded;
		return ra - rb;
	});
}

/**
 * 面板与甘特的最终顺序入口。
 * 非 manual 档原样返回，调用方不必自己判断（少一处会忘的条件分支）。
 */
export function applyManualOrderIfNeeded(
	result: GroupingResult,
	mode: GroupingMode,
	sortMode: SortMode,
	order: ManualOrder,
): GroupingResult {
	if (sortMode !== "manual") return result;
	return applyManualOrder(result, mode, order);
}

export function applyManualOrder(
	result: GroupingResult,
	mode: GroupingMode,
	order: ManualOrder,
): GroupingResult {
	const groupOrder = order.groups[mode] ?? [];
	return {
		...result,
		// 快速分区与普通分组在两个不同区块里，各自按同一份顺序表重排即可，不会互相插队
		quickGroups: reorderByKey(groupOrder, result.quickGroups, (group) => group.folder).map(
			(group) => ({
				...group,
				projects: reorderProjects(group.projects, group.folder, mode, order),
			}),
		),
		normalGroups: reorderByKey(groupOrder, result.normalGroups, (group) => group.key).map(
			(group) => ({
				...group,
				projects: reorderProjects(group.projects, group.key, mode, order),
			}),
		),
	};
}

function reorderProjects(
	projects: ProjectItem[],
	groupKey: string,
	mode: GroupingMode,
	order: ManualOrder,
): ProjectItem[] {
	const paths = order.projects[projectOrderKey(mode, groupKey)];
	if (paths === undefined || paths.length === 0) return projects;
	return reorderByKey(paths, projects, (project) => project.file.path);
}
