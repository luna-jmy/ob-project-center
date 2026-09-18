import { ProjectItem, ProjectMasterSettings } from "../types";

/**
 * 分组服务（SPEC §4 F3/F4）—— 纯函数，零 Obsidian 依赖。
 *
 * 规则表转写自 ref/projectOverview.js renderProjects()：
 * - 快速项目分区（仅 folder 分组模式生效）：
 *   · 位于扫描目录根层（folder === scanFolder）→ 标题「快速项目（根目录）」，固定排最前；
 *   · 路径段精确等于 quickProjectMarker（按段不按子串，「非快速项目集」不算）
 *     → 分区止于标记段，更深层子文件夹并入同一分区；
 *     标题 = 去掉扫描前缀后「/」→「 > 」（如「市场部 > 快速项目」）；
 *   · 分区排序按路径码点序（脚本用 localeCompare；沿用 filter-service 的
 *     确定性口径——「市 U+5E02 < 行 U+884C」两种排序结果一致）。
 * - 正常分组（folder 模式）：按文件夹分组；main-project: true 为代表；
 *   多项目且无 main-project → warning「multiple-projects」（脚本 ⚠️ 徽章语义）。
 * - 组排序：代表 due 降序（脚本 sortDate 行为）→ 无日期在后 → key 码点序。
 * - 组内笔记：排除代表路径，截断 maxNotesPerProject（0 = 不限，脚本语义）。
 * - objective/area 分组模式（F4.1，新增能力）：整表按值重分组，
 *   快速分区不生效；缺省值落「（未设置）」桶且固定排最后；
 *   不产出 multiple-projects 警告（同值多项目是该模式下的正常形态）。
 */

export interface NoteLink {
	path: string;
	name: string;
}

export interface QuickGroup {
	title: string;
	/** 分区对应的文件夹路径（根目录组 = 扫描目录本身） */
	folder: string;
	projects: ProjectItem[];
}

export interface NormalGroup {
	/** folder 模式 = 文件夹路径；objective/area 模式 = 分组值 */
	key: string;
	representative: ProjectItem | null;
	projects: ProjectItem[];
	warning?: "multiple-projects";
	notes?: {
		shown: NoteLink[];
		remaining: number;
	};
}

export interface GroupingResult {
	quickGroups: QuickGroup[];
	normalGroups: NormalGroup[];
}

export interface GroupingOptions {
	/**
	 * 文件夹路径 → 该文件夹全部笔记（含非项目笔记，视图层从 metadataCache 收集）。
	 * 提供时为 folder 模式的组输出组内笔记列表。
	 */
	folderNotes?: Record<string, NoteLink[]>;
}

/** objective/area 缺省桶（脚本 UI 文案口径） */
const FALLBACK_KEY = "（未设置）";

function compareCodepoint(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function pushTo(map: Map<string, ProjectItem[]>, key: string, item: ProjectItem): void {
	const bucket = map.get(key);
	if (bucket === undefined) {
		map.set(key, [item]);
	} else {
		bucket.push(item);
	}
}

/** 找到条目所属的扫描目录（`===` 或 `sf/` 前缀，避免「100 Projects2」误匹配）；不在范围内返回 null */
function matchScanFolder(folder: string, scanFolders: string[]): string | null {
	const found = scanFolders.find((sf) => folder === sf || folder.startsWith(`${sf}/`));
	return found !== undefined ? found : null;
}

export function groupProjects(
	items: ProjectItem[],
	settings: ProjectMasterSettings,
	options: GroupingOptions = {},
): GroupingResult {
	if (settings.defaultGrouping === "folder") {
		return groupByFolder(items, settings, options);
	}
	return groupByValue(items, settings);
}

/** folder 模式：快速分区（F3.1）+ 文件夹分组（F3.2）+ 组内笔记（F3.3） */
function groupByFolder(
	items: ProjectItem[],
	settings: ProjectMasterSettings,
	options: GroupingOptions,
): GroupingResult {
	const rootQuick = new Map<string, ProjectItem[]>();
	const markerQuick = new Map<string, ProjectItem[]>();
	const normal = new Map<string, ProjectItem[]>();

	for (const item of items) {
		const scanFolder = matchScanFolder(item.file.folder, settings.scanFolders);
		if (scanFolder === null) {
			// 越界条目兜底按文件夹分组（索引层通常已过滤，这里保证不丢数据）
			pushTo(normal, item.file.folder, item);
			continue;
		}
		if (item.file.folder === scanFolder) {
			// 根层项目 → 快速分区
			pushTo(rootQuick, scanFolder, item);
			continue;
		}
		const relative = item.file.folder.slice(scanFolder.length + 1);
		const segments = relative.split("/");
		// 按段精确匹配，不按子串
		const markerIndex = segments.indexOf(settings.quickProjectMarker);
		if (markerIndex !== -1) {
			// 分区止于标记段（脚本 slice(0, idx + 1) 行为）
			const bucket = `${scanFolder}/${segments.slice(0, markerIndex + 1).join("/")}`;
			pushTo(markerQuick, bucket, item);
			continue;
		}
		pushTo(normal, item.file.folder, item);
	}

	const quickGroups: QuickGroup[] = [];
	// 根目录组固定排最前（脚本 push 顺序）
	for (const [folder, projects] of rootQuick) {
		quickGroups.push({ title: "快速项目（根目录）", folder, projects });
	}
	const sortedMarkerEntries = [...markerQuick.entries()].sort((a, b) =>
		compareCodepoint(a[0], b[0]),
	);
	for (const [folder, projects] of sortedMarkerEntries) {
		const scanFolder = matchScanFolder(folder, settings.scanFolders);
		const relative = scanFolder !== null ? folder.slice(scanFolder.length + 1) : folder;
		quickGroups.push({
			title: relative.split("/").join(" > "),
			folder,
			projects,
		});
	}

	const normalGroups: NormalGroup[] = [];
	for (const [key, projects] of normal) {
		normalGroups.push(buildGroup(key, projects, true));
	}
	normalGroups.sort((a, b) => compareByRepresentative(a, b));

	if (options.folderNotes !== undefined) {
		for (const group of normalGroups) {
			attachNotes(group, options.folderNotes, settings.maxNotesPerProject);
		}
	}

	return { quickGroups, normalGroups };
}

/** objective/area 模式（F4.1）：整表按值重分组；快速分区不生效 */
function groupByValue(items: ProjectItem[], settings: ProjectMasterSettings): GroupingResult {
	const buckets = new Map<string, ProjectItem[]>();
	for (const item of items) {
		let key: string;
		if (settings.defaultGrouping === "objective") {
			key = item.objective !== null ? item.objective : FALLBACK_KEY;
		} else {
			// area 多值取第一个作为分组键（F4.1 简化口径）
			key = item.area.length > 0 ? item.area[0] : FALLBACK_KEY;
		}
		pushTo(buckets, key, item);
	}

	const normalGroups: NormalGroup[] = [];
	for (const [key, projects] of buckets) {
		normalGroups.push(buildGroup(key, projects, false));
	}
	// 缺省桶固定排最后；其余沿用正常组排序规则
	normalGroups.sort((a, b) => {
		const fa = a.key === FALLBACK_KEY ? 1 : 0;
		const fb = b.key === FALLBACK_KEY ? 1 : 0;
		if (fa !== fb) return fa - fb;
		return compareByRepresentative(a, b);
	});

	return { quickGroups: [], normalGroups };
}

/** 代表逻辑：useMainFlag 时优先 main-project: true，否则取首个；多项目无主 → 警告 */
function buildGroup(key: string, projects: ProjectItem[], useMainFlag: boolean): NormalGroup {
	let representative: ProjectItem | null = null;
	let hasMain = false;
	if (useMainFlag) {
		const main = projects.find((p) => p.mainProject);
		if (main !== undefined) {
			representative = main;
			hasMain = true;
		}
	}
	if (representative === null && projects.length > 0) {
		representative = projects[0];
	}
	const group: NormalGroup = { key, representative, projects };
	// ⚠️ 徽章语义：仅 folder 模式有意义（一个文件夹预期一个项目文档）
	if (useMainFlag && !hasMain && projects.length > 1) {
		group.warning = "multiple-projects";
	}
	return group;
}

/** 组排序：代表 due 降序（脚本 sortDate 行为）→ 无日期在后 → key 码点序 */
function compareByRepresentative(a: NormalGroup, b: NormalGroup): number {
	const da = a.representative !== null ? a.representative.dueDate : null;
	const db = b.representative !== null ? b.representative.dueDate : null;
	if (da !== null && db !== null && da !== db) {
		return da > db ? -1 : 1;
	}
	if (da !== null && db === null) return -1;
	if (da === null && db !== null) return 1;
	return compareCodepoint(a.key, b.key);
}

/** 组内笔记：排除代表路径；maxNotesPerProject = 0 表示不限（脚本语义） */
function attachNotes(
	group: NormalGroup,
	folderNotes: Record<string, NoteLink[]>,
	maxNotesPerProject: number,
): void {
	const all = folderNotes[group.key] ?? [];
	const repPath = group.representative !== null ? group.representative.file.path : null;
	const candidates = repPath !== null ? all.filter((n) => n.path !== repPath) : all;
	const shown = maxNotesPerProject === 0 ? candidates : candidates.slice(0, maxNotesPerProject);
	group.notes = { shown, remaining: candidates.length - shown.length };
}
