import { t } from "../i18n";
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
 * ── 规则表（继承 ref/projectOverview.js），以及三处按新口径的修正 ────────
 * - 快速项目分区（仅 folder 模式）：扫描目录根层项目 → 「快速项目（根目录）」固定最前；
 *   路径段精确等于 quickProjectMarker → 分区止于标记段；标题 = 去扫描前缀后「/」→「 > 」；
 * - 正常分组：main-project: true 为代表；多项目且无 main-project → warning；
 * - 组排序：代表 due 降序 → 无日期在后 → key 码点序；
 * - 组内资料：**修正 1** 递归子文件夹归集（脚本只看同层，新模型下同层通常为空）；
 *   **修正 2** 同层的其他项目文档不再当资料（脚本会把它们列进笔记列表）；
 *   **修正 3**（2026-09-20）递归时遇到「别的项目的地盘」整棵剪掉——见下；
 * - 截断仍按 maxNotesPerProject（0 = 不限，脚本语义）。
 *
 * ── 修正 3：别人的地盘不能算我的资料（用户口径 2026-09-20）─────────────
 * 场景：一个还没资料的项就是一封**单独的项目笔记**，而它所在的目录里放着**好几个
 * 项目文件夹**（典型的中间层目录，例如 `100 Projects/2026工作项目/某项目.md`）。
 * 只按「递归该目录」收集，兄弟项目文件夹里的资料会全部算到它头上——
 * 表现就是「一个明明没资料的项目，凭空长出十几条资料」。
 *
 * 口径（用户确认 2026-09-20）：**子树里（任意深度）放着项目文档的文件夹 = 那个项目的地盘**。
 * 归集时自己的地盘照收，别人的地盘（及其子树）整棵剪掉。
 *
 * 于是「项目文件夹里的非项目子文件夹（如 `资料/`）仍然算资料」——
 * 只要这个子文件夹里没有 `type: project` 的笔记就行。
 * 这条规则同时表达了用户对自己 vault 的描述「带资料的项目文件夹没有子文件夹，
 * 有子文件夹说明它还没资料」：那种情况下，每个子文件夹里都住着另一个项目文档。
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

/**
 * 「不分组」模式三块分区的 key。
 *
 * 加 `kind:` 前缀是为了不跟文件夹路径 / objective / area 的值撞车：
 * 这些 key 会被当作折叠状态与手动排序的键（同 manual-order 的 `${mode}::${key}` 口径）。
 */
const KIND_QUICK_KEY = "kind:quick";
/** 不分组模式的扁平列表（除快速项目外的全部项目） */
const KIND_ALL_KEY = "kind:all";

export function groupProjects(
	items: ProjectItem[],
	settings: ProjectMasterSettings,
	options: GroupingOptions = {},
): GroupingResult {
	const ctx = buildCollectContext(items, options);

	const quickPaths = items
		.filter((item) => isQuickProject(item, settings))
		.map((item) => item.file.path);

	// 资料按项目归集只在调用方提供了笔记清单时才有意义（否则整表为空）。
	// 注意顺序：不分组模式要按「有没有资料」分块，所以它必须先算出来。
	const materialsByPath = ctx.hasFolderNotes ? buildMaterialsByPath(items, settings, ctx) : {};

	const base =
		settings.defaultGrouping === "folder"
			? groupByFolder(items, settings, ctx)
			: settings.defaultGrouping === "none"
				? groupByKind(items, quickPaths)
				: groupByValue(items, settings, ctx);

	return { ...base, quickPaths, materialsByPath };
}

/**
 * 「不分组」模式（用户口径 2026-09-21）：**真的不分组**——除快速项目单独成区外，
 * 所有项目合成一份扁平列表，一个项目一张卡片。
 *
 * 为什么改（原来是按「有没有资料 + 快速项目」切三块）：用户在设置里选的是「不分组」，
 * 界面却给出「有资料」「没资料」两个看起来像分类的标题——那不是分组维度，
 * 而是项目的**形态**。形态差异仍然保留，只是退回**卡片样式**里去
 * （folder 模式下带资料 → 独立框框、不带资料 → 紧凑列表，见 `splitByKind`）。
 *
 * 快速项目仍然单独成区，且排在最前（与 folder 模式的「快速项目（根目录）」同一惯例）：
 * 它是另一种形态——没有自己的项目文件夹，资料恒为空（见 `buildMaterialsByPath`），
 * 并进扁平列表只会让那张卡片没有归属。
 *
 * 不调 `attachNotes()`：扁平列表里每张卡片各自带自己的资料清单（`materialsByPath`），
 * 再挂一份「整张列表的并集」既重复，又会被 maxNotesPerProject 截断成一个误导性的数字。
 */
function groupByKind(items: ProjectItem[], quickPaths: string[]): GroupBuckets {
	const quickSet = new Set(quickPaths);
	// 两次过滤都用同一个判定（与 isQuickProject 同源），避免「哪些算快速项目」出现第二份口径
	const quickProjects = items.filter((item) => quickSet.has(item.file.path));
	const rest = items.filter((item) => !quickSet.has(item.file.path));

	const quickGroups: QuickGroup[] =
		quickProjects.length === 0
			? []
			: [{ folder: KIND_QUICK_KEY, title: t("快速项目"), projects: quickProjects }];

	// 保持排序档给出的顺序：过滤比「把两个形态桶拼起来」更不容易打乱顺序
	return {
		quickGroups,
		// useMainFlag 传 false：这里「一组多个项目」是常态，不是 folder 模式那种
		// 「多项目却没有 main-project」的数据问题，不该报 multiple-projects 警告
		normalGroups:
			rest.length === 0 ? [] : [buildGroup(KIND_ALL_KEY, "全部项目", rest, false)],
	};
}

/**
 * 归集资料的解析结果。一次解析、两层（分组维度 / 项目维度）共用，
 * 避免「什么算资料」的口径在多处各写一遍然后慢慢漂移。
 */
interface CollectContext {
	folderNotes: Record<string, NoteLink[]>;
	/** 调用方是否提供了笔记清单：没提供就不算资料（避免把「没数据」当成「没有资料」） */
	hasFolderNotes: boolean;
	/** 全部项目文档路径：它们不是资料 */
	excludedProjects: Set<string>;
	/** 「别人的地盘」：子树里有项目文档的文件夹 */
	turfFolders: Set<string>;
}

/**
 * 把某封笔记的**所有祖先文件夹**记进集合。
 *
 * 用整棵子树判定「这是谁的地盘」：只要子文件夹里（任意深度）存在 `type: project`
 * 的笔记，那一片就不是资料（用户口径 2026-09-20）。逐层都记，
 * 才能让 `资料/` 里藏了一个归档项目时，`资料/` 整体退出资料统计。
 */
function addAncestorFolders(path: string, into: Set<string>): void {
	const segments = path.split("/");
	for (let depth = segments.length - 1; depth > 0; depth -= 1) {
		into.add(segments.slice(0, depth).join("/"));
	}
}

function buildCollectContext(items: ProjectItem[], options: GroupingOptions): CollectContext {
	// 索引里的全量项目路径优先：筛选只影响「显示什么」，不该改变 vault 的结构事实
	// （被筛掉的项目，其文件夹依然是别人的地盘）。没传就退回当前项目集。
	const paths = options.projectPaths ?? items.map((item) => item.file.path);
	const turfFolders = new Set<string>();
	for (const path of paths) {
		addAncestorFolders(path, turfFolders);
	}
	// 当前项目集无条件并入：即使只有它自己，它的文件夹也是「有主的」
	for (const item of items) {
		addAncestorFolders(item.file.path, turfFolders);
	}
	return {
		folderNotes: options.folderNotes ?? {},
		hasFolderNotes: options.folderNotes !== undefined,
		excludedProjects: new Set(options.projectPaths ?? []),
		turfFolders,
	};
}

/**
 * 这个笔记文件夹是否落在**别人的地盘**里（含地盘本身）。
 *
 * 从笔记所在文件夹往上走：先撞到自己的收集根 → 属于自己；先撞到别人的地盘 → 不属于。
 * 「自己的根优先」这条很重要：`官网改版/资料/` 向上会撞到根 `官网改版`（它自己也是地盘，
 * 因为它下面有项目文档），先判根才能把 `资料/` 里的资料收进来。
 */
function isOutsideOwnTurf(
	noteFolder: string,
	roots: ReadonlySet<string>,
	turfFolders: ReadonlySet<string>,
): boolean {
	let cursor = noteFolder;
	for (;;) {
		if (roots.has(cursor)) return false;
		if (turfFolders.has(cursor)) return true;
		const cut = cursor.lastIndexOf("/");
		if (cut === -1) return false;
		cursor = cursor.slice(0, cut);
	}
}

/** 项目路径 → 它自己文件夹下的资料/笔记（快速项目恒为空） */
function buildMaterialsByPath(
	items: ProjectItem[],
	settings: ProjectMasterSettings,
	ctx: CollectContext,
): Record<string, NoteLink[]> {
	const out: Record<string, NoteLink[]> = {};
	for (const item of items) {
		out[item.file.path] = isQuickProject(item, settings)
			? []
			: collectNotes([item.file.folder], ctx, item.file.path);
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
	ctx: CollectContext,
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
		quickGroups.push({ folder, title: t("快速项目（根目录）"), projects });
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

	if (ctx.hasFolderNotes) {
		for (const group of normalGroups) {
			attachNotes(group, [group.key], ctx, settings.maxNotesPerProject);
		}
	}

	return { quickGroups, normalGroups };
}

/** objective/area 模式（F4.1）：整表按值重分组；快速分区不生效 */
function groupByValue(
	items: ProjectItem[],
	settings: ProjectMasterSettings,
	ctx: CollectContext,
): GroupBuckets {
	const buckets = new Map<string, ProjectItem[]>();
	for (const item of items) {
		const key =
			settings.defaultGrouping === "objective"
				? (item.objective ?? FALLBACK_KEY)
				: (item.area ?? FALLBACK_KEY);
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

	if (ctx.hasFolderNotes) {
		for (const group of normalGroups) {
			// 值分组横跨多个文件夹：把成员项目各自的文件夹都并进来
			// （它们都是「自己的根」，所以互相嵌套的成员项目不会被彼此剪掉）
			const folders = [...new Set(group.projects.map((p) => p.file.folder))];
			attachNotes(group, folders, ctx, settings.maxNotesPerProject);
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

/**
 * 归集资料/笔记（F3.3，用户口径）：
 * - **递归**：`folderNotes` 的 key 等于目标文件夹、或位于其下（`key/` 前缀）都算；
 * - **剪掉别人的地盘**：沿途撞上「子树里有项目文档的文件夹」（且不是自己的收集根）
 *   就整棵跳过——那是别的项目，不是我的资料（修正 3）；
 * - 剔除 `alsoExcludePath`（分组维度传代表项目，项目维度传项目自己）；
 * - 剔除全部项目文档（项目不是资料）；
 * - 按路径码点序稳定排序，保证同一份数据每次渲染顺序一致。
 *
 * 分组维度与项目维度共用这一个函数，避免两处「什么算资料」的口径漂移。
 */
function collectNotes(
	folders: string[],
	ctx: CollectContext,
	alsoExcludePath: string | null,
): NoteLink[] {
	const roots = new Set(folders);
	const seen = new Set<string>();
	const candidates: NoteLink[] = [];

	for (const folder of folders) {
		for (const [noteFolder, notes] of Object.entries(ctx.folderNotes)) {
			if (noteFolder !== folder && !noteFolder.startsWith(`${folder}/`)) continue;
			if (isOutsideOwnTurf(noteFolder, roots, ctx.turfFolders)) continue;
			for (const note of notes) {
				if (note.path === alsoExcludePath) continue;
				if (ctx.excludedProjects.has(note.path)) continue;
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
	ctx: CollectContext,
	maxNotesPerProject: number,
): void {
	const repPath = group.representative !== null ? group.representative.file.path : null;
	const candidates = collectNotes(folders, ctx, repPath);
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
