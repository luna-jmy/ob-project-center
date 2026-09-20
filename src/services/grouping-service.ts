import { GroupSectionSpec, ProjectItem, ProjectMasterSettings } from "../types";

/**
 * 分组服务（SPEC §4 F3/F4）—— 纯函数，零 Obsidian 依赖。
 *
 * ── 数据模型（按用户口径修正，2026-09-18）──────────────────────────────
 * 项目文件夹有两种形态：
 *   A. 只有项目文档：文件夹里就一份带完整 frontmatter 的项目笔记；
 *   B. 项目文档 + 资料/笔记：项目文档在文件夹里，资料/笔记在**其子文件夹**中。
 * 资料/笔记与普通笔记无异、不含任何项目 frontmatter——它们只是「住在」项目文件夹下面。
 * 因此：
 * - 卡片上的数量是**该项目下的资料/笔记数**，绝不是「这个文件夹里有几个项目」；
 * - 资料归集是**递归**的（子文件夹、孙文件夹都算）；
 * - 索引里的其他项目文档不计入资料数（它们是项目，不是资料）。
 *
 * ── 规则表（继承 ref/projectOverview.js），以及两处按新口径的修正 ────────
 * - 快速项目分区（仅 folder 模式）：扫描目录根层项目 → 「快速项目（根目录）」固定最前；
 *   路径段精确等于 quickProjectMarker → 分区止于标记段；标题 = 去扫描前缀后「/」→「 > 」；
 * - 正常分组：main-project: true 为代表；多项目且无 main-project → warning；
 * - 组排序：代表 due 降序 → 无日期在后 → key 码点序；
 * - 组内资料：**修正 1** 递归子文件夹归集（脚本只看同层，新模型下同层通常为空）；
 *   **修正 2** 同层的其他项目文档不再当资料（脚本会把它们列进笔记列表）；
 * - 截断仍按 maxNotesPerProject（0 = 不限，脚本语义）。
 *
 * ── 供甘特图使用的分节 ─────────────────────────────────────────────
 * `toSectionSpecs()` 把分组结果转成甘特分节，两侧**共用同一份分组结果**，
 * 因此左侧卡片与右侧分节永远一一对应（这是「左右联动」的地基）。
 */

export interface NoteLink {
	path: string;
	name: string;
}

export interface QuickGroup {
	/** 分区文件夹路径（根目录组 = 扫描目录本身）；同时作为联动用的 key */
	folder: string;
	title: string;
	projects: ProjectItem[];
}

export interface NormalGroup {
	/** folder 模式 = 文件夹路径；objective/area 模式 = 分组值。联动 key */
	key: string;
	/** 展示标题：folder 模式 = 相对扫描目录的路径（/ → " > "）；值模式 = 分组值本身 */
	title: string;
	representative: ProjectItem | null;
	projects: ProjectItem[];
	warning?: "multiple-projects";
	notes?: {
		shown: NoteLink[];
		remaining: number;
		/** 该分组下的资料/笔记总数（含未展示的部分） */
		total: number;
	};
}

export interface GroupingResult {
	quickGroups: QuickGroup[];
	normalGroups: NormalGroup[];
	/**
	 * 快速项目路径集合。面板要用它把「快速项目」和「带资料的项目」分开，
	 * 而快速项目是相对扫描目录定义的（根层 / 路径含标记段），不该让视图层自己猜。
	 */
	quickPaths: string[];
	/**
	 * 项目路径 → **该项目自己文件夹下**的资料/笔记（递归，不含任何项目文档）。
	 *
	 * 与 `NormalGroup.notes` 的区别：那个是**分组**维度的数字（值分组横跨多个文件夹时是并集），
	 * 这个是**单个项目**维度的，用于面板的「带资料 → 独立框框 / 不带资料 → 紧凑列表」二分。
	 * 快速项目恒为空——它没有自己的文件夹，所在目录（扫描根层/快速项目文件夹）是大家共用的。
	 */
	materialsByPath: Record<string, NoteLink[]>;
}

export interface GroupingOptions {
	/**
	 * 笔记的**所在文件夹** → 该文件夹直接子笔记。
	 * 层级聚合由本服务完成（组 key 之下的所有子孙文件夹都会被归集），
	 * 调用方只需如实提供「每个文件夹里直接有哪些笔记」。
	 */
	folderNotes?: Record<string, NoteLink[]>;
	/**
	 * 索引内的全部项目文档路径。用于把项目文档从「资料/笔记」里剔除——
	 * 项目文档不是资料（SPEC 用户口径 2026-09-18）。
	 */
	projectPaths?: string[];
}

/** objective/area 缺省桶（脚本 UI 文案口径） */
export const FALLBACK_KEY = "（未设置）";

/**
 * 项目的三种形态（用户口径 2026-09-18，面板据此决定「框框」还是「列表」）。
 * 判定顺序即优先级：**先判快速项目**——它天然没有自己的资料目录，
 * 不该因为「所在目录里恰好有别的笔记」而被算成带资料。
 */
export type ProjectKind = "quick" | "with-materials" | "plain";

export interface ProjectKindBuckets {
	/** 有自己文件夹且文件夹下有资料 → 面板给独立框框 */
	withMaterials: ProjectItem[];
	/** 有自己文件夹但没有资料 → 面板给紧凑列表 */
	plain: ProjectItem[];
	/** 没有自己的文件夹 → 另一份紧凑列表（⚡ 标记） */
	quick: ProjectItem[];
}

export function classifyProject(
	project: ProjectItem,
	quickPaths: ReadonlySet<string>,
	materialsByPath: Record<string, NoteLink[]>,
): ProjectKind {
	if (quickPaths.has(project.file.path)) return "quick";
	return (materialsByPath[project.file.path]?.length ?? 0) > 0 ? "with-materials" : "plain";
}

export function splitByKind(
	projects: ProjectItem[],
	quickPaths: ReadonlySet<string>,
	materialsByPath: Record<string, NoteLink[]>,
): ProjectKindBuckets {
	const buckets: ProjectKindBuckets = { withMaterials: [], plain: [], quick: [] };
	for (const project of projects) {
		switch (classifyProject(project, quickPaths, materialsByPath)) {
			case "quick":
				buckets.quick.push(project);
				break;
			case "with-materials":
				buckets.withMaterials.push(project);
				break;
			default:
				buckets.plain.push(project);
		}
	}
	return buckets;
}

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

/**
 * 文件夹路径 → 展示标题：去掉扫描目录前缀，层级用「 > 」连接。
 * 与现有脚本 `folderPath.replace("100 Projects/", "").replace(/\//g, " > ")` 同一口径。
 */
export function folderDisplayTitle(folderPath: string, scanFolders: string[]): string {
	const scan = matchScanFolder(folderPath, scanFolders);
	if (scan === null) return folderPath.split("/").join(" > ");
	const relative = folderPath.slice(scan.length + 1);
	return relative.length === 0 ? folderPath : relative.split("/").join(" > ");
}

/**
 * 是不是「快速项目」？快速项目 = 没有自己的项目文件夹：
 * 项目文档直接放在扫描目录根层，或所处的相对路径里有快速项目标记段。
 *
 * 这是「快速项目 / 带资料的项目」这条二分线的**唯一判定口径**，
 * 分组分桶、面板分区、资料归集（快速项目没有自己的资料目录）全部复用它。
 */
export function isQuickProject(item: ProjectItem, settings: ProjectMasterSettings): boolean {
	const folder = item.file.folder;
	const scan = matchScanFolder(folder, settings.scanFolders);
	if (scan === null) return false; // 越界条目按普通项目处理（不会丢数据）
	if (folder === scan) return true; // 扫描目录根层
	const relative = folder.slice(scan.length + 1);
	return relative.split("/").includes(settings.quickProjectMarker);
}

export function groupProjects(
	items: ProjectItem[],
	settings: ProjectMasterSettings,
	options: GroupingOptions = {},
): GroupingResult {
	const base =
		settings.defaultGrouping === "folder"
			? groupByFolder(items, settings, options)
			: groupByValue(items, settings, options);

	const quickPaths = items
		.filter((item) => isQuickProject(item, settings))
		.map((item) => item.file.path);

	// 资料按项目归集只在调用方提供了笔记清单时才有意义（否则整表为空）
	const materialsByPath =
		options.folderNotes === undefined
			? {}
			: buildMaterialsByPath(items, settings, options);

	return { ...base, quickPaths, materialsByPath };
}

/** 项目路径 → 它自己文件夹下的资料/笔记（快速项目恒为空） */
function buildMaterialsByPath(
	items: ProjectItem[],
	settings: ProjectMasterSettings,
	options: GroupingOptions,
): Record<string, NoteLink[]> {
	const folderNotes = options.folderNotes ?? {};
	const excluded = excludeSet(options.projectPaths);
	const out: Record<string, NoteLink[]> = {};
	for (const item of items) {
		out[item.file.path] = isQuickProject(item, settings)
			? []
			: collectNotes([item.file.folder], folderNotes, excluded, item.file.path);
	}
	return out;
}

/** 分桶结果（分组服务内部形态）：快速分区 + 正常分组，**不含**快速标记与按项目归集的资料 */
interface GroupBuckets {
	quickGroups: QuickGroup[];
	normalGroups: NormalGroup[];
}

/** folder 模式：快速分区（F3.1）+ 文件夹分组（F3.2）+ 项目资料（F3.3） */
function groupByFolder(
	items: ProjectItem[],
	settings: ProjectMasterSettings,
	options: GroupingOptions,
): GroupBuckets {
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
		quickGroups.push({ folder, title: "快速项目（根目录）", projects });
	}
	const sortedMarkerEntries = [...markerQuick.entries()].sort((a, b) =>
		compareCodepoint(a[0], b[0]),
	);
	for (const [folder, projects] of sortedMarkerEntries) {
		quickGroups.push({
			folder,
			title: folderDisplayTitle(folder, settings.scanFolders),
			projects,
		});
	}

	const normalGroups: NormalGroup[] = [];
	for (const [key, projects] of normal) {
		// 标题走展示口径（去掉扫描目录前缀、层级用「 > 」），key 保持完整路径用于联动
		normalGroups.push(buildGroup(key, folderDisplayTitle(key, settings.scanFolders), projects, true));
	}
	normalGroups.sort((a, b) => compareByRepresentative(a, b));

	if (options.folderNotes !== undefined) {
		const excluded = excludeSet(options.projectPaths);
		for (const group of normalGroups) {
			attachNotes(group, [group.key], options.folderNotes, excluded, settings.maxNotesPerProject);
		}
	}

	return { quickGroups, normalGroups };
}

/** objective/area 模式（F4.1）：整表按值重分组；快速分区不生效 */
function groupByValue(
	items: ProjectItem[],
	settings: ProjectMasterSettings,
	options: GroupingOptions,
): GroupBuckets {
	const buckets = new Map<string, ProjectItem[]>();
	for (const item of items) {
		const key =
			settings.defaultGrouping === "objective"
				? (item.objective ?? FALLBACK_KEY)
				: (item.area[0] ?? FALLBACK_KEY);
		pushTo(buckets, key, item);
	}

	const normalGroups: NormalGroup[] = [];
	for (const [key, projects] of buckets) {
		normalGroups.push(buildGroup(key, key, projects, false));
	}
	// 缺省桶固定排最后；其余沿用正常组排序规则
	normalGroups.sort((a, b) => {
		const fa = a.key === FALLBACK_KEY ? 1 : 0;
		const fb = b.key === FALLBACK_KEY ? 1 : 0;
		if (fa !== fb) return fa - fb;
		return compareByRepresentative(a, b);
	});

	if (options.folderNotes !== undefined) {
		const excluded = excludeSet(options.projectPaths);
		for (const group of normalGroups) {
			// 值分组横跨多个文件夹：把成员项目各自的文件夹都并进来
			const folders = [...new Set(group.projects.map((p) => p.file.folder))];
			attachNotes(group, folders, options.folderNotes, excluded, settings.maxNotesPerProject);
		}
	}

	return { quickGroups: [], normalGroups };
}

/** 代表逻辑：useMainFlag 时优先 main-project: true，否则取首个；多项目无主 → 警告 */
function buildGroup(
	key: string,
	title: string,
	projects: ProjectItem[],
	useMainFlag: boolean,
): NormalGroup {
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
	const group: NormalGroup = { key, title, representative, projects };
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

function excludeSet(projectPaths: string[] | undefined): Set<string> {
	return new Set(projectPaths ?? []);
}

/**
 * 归集资料/笔记（F3.3，用户口径）：
 * - **递归**：`folderNotes` 的 key 等于目标文件夹、或位于其下（`key/` 前缀）都算；
 * - 剔除 `alsoExcludePath`（分组维度传代表项目，项目维度传项目自己）；
 * - 剔除全部项目文档（项目不是资料）；
 * - 按路径码点序稳定排序，保证同一份数据每次渲染顺序一致。
 *
 * 分组维度与项目维度共用这一个函数，避免两处「什么算资料」的口径漂移。
 */
function collectNotes(
	folders: string[],
	folderNotes: Record<string, NoteLink[]>,
	excludedProjects: Set<string>,
	alsoExcludePath: string | null,
): NoteLink[] {
	const seen = new Set<string>();
	const candidates: NoteLink[] = [];

	for (const folder of folders) {
		for (const [noteFolder, notes] of Object.entries(folderNotes)) {
			if (noteFolder !== folder && !noteFolder.startsWith(`${folder}/`)) continue;
			for (const note of notes) {
				if (note.path === alsoExcludePath) continue;
				if (excludedProjects.has(note.path)) continue;
				if (seen.has(note.path)) continue;
				seen.add(note.path);
				candidates.push(note);
			}
		}
	}

	candidates.sort((a, b) => compareCodepoint(a.path, b.path));
	return candidates;
}

/** 分组维度的资料：递归归集 + 按 maxNotesPerProject 截断（0 = 不限） */
function attachNotes(
	group: NormalGroup,
	folders: string[],
	folderNotes: Record<string, NoteLink[]>,
	excludedProjects: Set<string>,
	maxNotesPerProject: number,
): void {
	const repPath = group.representative !== null ? group.representative.file.path : null;
	const candidates = collectNotes(folders, folderNotes, excludedProjects, repPath);
	const shown =
		maxNotesPerProject === 0 ? candidates : candidates.slice(0, maxNotesPerProject);
	group.notes = {
		shown,
		remaining: candidates.length - shown.length,
		total: candidates.length,
	};
}

/**
 * 分组结果 → 甘特分节（左右一一对应的地基）。
 *
 * 顺序与左侧面板的视觉顺序完全一致：先快速项目分区，再正常分组。
 * 两侧吃的是**同一份分组结果**，所以不会再出现「左边按文件夹、右边按 objective」的错位。
 * `title` 在两种模式下都已算好（folder 模式是相对路径，值模式是分组值本身）。
 */
export function toSectionSpecs(result: GroupingResult): Omit<GroupSectionSpec, "collapsed">[] {
	const specs: Omit<GroupSectionSpec, "collapsed">[] = [];
	for (const group of result.quickGroups) {
		specs.push({
			key: group.folder,
			name: group.title,
			paths: group.projects.map((p) => p.file.path),
		});
	}
	for (const group of result.normalGroups) {
		specs.push({
			key: group.key,
			name: group.title,
			paths: group.projects.map((p) => p.file.path),
		});
	}
	return specs;
}
