import { Component } from "obsidian";
import { GANTT_SKIP_MESSAGES, GanttSkipReason } from "../gantt/gantt-model";
import { childKeys, DragReorder, DragReorderCommit } from "./drag-reorder";
import {
	GroupingResult,
	NormalGroup,
	NoteLink,
	QuickGroup,
	splitByKind,
} from "../services/grouping-service";
import { GroupingMode, PRIORITY_EMOJI, ProjectItem, STATUS_EMOJI, ProjectStatus } from "../types";

/**
 * 分组面板（SPEC §4 F3 + 用户口径 2026-09-18 / 2026-09-20）—— 规则全部来自
 * grouping-service，这里只画与转发交互。
 *
 * ── 定位：**只读的旁证面板**（用户口径 2026-09-20，2026-09-21 修订）──────────────
 * 「面板唯一的意义是看到里面具体有哪些资料/笔记」——所以这里：
 * - 顺序调整与项目编辑都在甘特区完成；**唯一例外**是面板模式：甘特被整页顶掉后，
 *   卡片可以拖动排序（面板模式下才有抓手，用户口径 2026-09-21）；
 * - 只保留三件事：① 点项目 → 甘特滚动定位到它；② 悬停 → 甘特任务条同步高亮；
 *   ③ 展开某个项目的资料/笔记清单（超出预览条数的可以展开看全）。
 * 分组结构仍与甘特分节一一对应（同一个 key），折叠也在两边同步。
 *
 * ── 事件模型：全部委托 ───────────────────────────────────────────────
 * 面板每次刷新整体重建，若按元素注册监听器，刷新 N 次就往 Component 上挂 N 批
 * （元素已脱离文档却被监听器表引用着 → 真实泄漏）。所以只在构造时注册一次，
 * 之后靠 data-* 分发。
 */

export interface GroupPanelCallbacks {
	onOpenNote(path: string): void;
	/** 点面板里的项目 → 甘特滚动定位（F3.4） */
	onFocusProject(path: string): void;
	/** 折叠/展开分组（key 与甘特分节 key 一致） */
	onToggleCollapse(key: string): void;
	/** 悬停某个项目 → 甘特对应任务条高亮；离开传 null */
	onHoverProject(path: string | null): void;
	/**
	 * 编辑项目（打开编辑弹窗）。
	 *
	 * 面板**自己**的入口，不依赖甘特：长期项目按设计不上甘特图，面板模式下甘特又被
	 * 整页顶掉——两件事叠加，这条路径是唯一能改动它们的口子（用户口径 2026-09-20）。
	 */
	onEditProject(path: string): void;
	/**
	 * 面板模式下拖动卡片 → 新的路径顺序（**不分组时**，卡片就是被拖动的单位）。
	 *
	 * 落盘复用甘特侧栏的同一套手动排序（manualProjectOrder），key 由容器上的
	 * `data-group-key` 给出；真正写设置与切换排序档在视图层完成。
	 */
	onReorderProjects(groupKey: string, paths: string[]): void;
	/**
	 * 面板模式下拖动**分组** → 新的分组 key 顺序（**分组时**，被拖动的单位是分组本身）。
	 *
	 * 分组模式下拖组内卡片没有意义（文件夹模式一组常常只有一个项目，
	 * 就是一张卡片），真正能排的是「哪个分组在前」——与甘特侧栏拖分节是同一件事，
	 * 落盘也走同一份 manualGroupOrder（用户口径 2026-09-21）。
	 *
	 * 传的是**完整** key 顺序：面板把「快速分区 + 普通分组」两个列表按屏幕顺序拼起来，
	 * 与甘特分节那边一致（manualGroupOrder 的 key 空间本来就是这两者共用）。
	 */
	onReorderGroups(keys: string[]): void;
}

export interface GroupPanelRenderOptions {
	mode: GroupingMode;
	/** 每个项目默认展示的资料条数（0 = 不限）；超出的折叠为「展开全部」 */
	maxNotes: number;
	collapsedKeys: Set<string>;
	/**
	 * 甘特图此刻是否在场（能不能被定位到）。
	 *
	 * 面板模式下甘特被整页顶掉，此时「点击定位」既看不见也做不到：于是提示文案与
	 * 点击行为**都不挂** —— 留一张看起来能点、点了毫无反应的卡片，比不给提示更糟
	 * （用户口径 2026-09-20）。
	 */
	canLocateInGantt: boolean;
	/**
	 * 面板模式（甘特被整页顶掉的整页卡片视图）。
	 * 只有这个模式下才挂拖动手柄——顺序调整从甘特侧栏挪到了面板自己身上。
	 */
	panelMode: boolean;
	/**
	 * 不会出现在甘特图上的项目 → 原因（长期 / 缺日期，口径来自甘特模型的 skipped）。
	 *
	 * 面板模式下甘特不在场，用户看不出「为什么这张卡片在图上没有」；
	 * 卡片用底色区分并悬停可见原因。非面板模式不用——甘特就在旁边，一眼可见。
	 */
	notOnGantt: ReadonlyMap<string, GanttSkipReason>;
}

/**
 * 单次渲染 DOM 里最多铺多少条资料。
 * 预览条数只是「默认显示几条」，展开要在同一个 DOM 里切换，
 * 所以真正的上限在这里——避免一个装了上千条笔记的文件夹把界面拖死。
 */
const MATERIAL_RENDER_CAP = 200;

/** 统一 QuickGroup / NormalGroup 的渲染形状，绘制逻辑只写一份 */
interface RenderableGroup {
	key: string;
	title: string;
	projects: ProjectItem[];
	isQuickGroup: boolean;
	warning?: "multiple-projects";
}

export class GroupPanel {
	private readonly dragReorder: DragReorder;

	constructor(
		private readonly component: Component,
		private readonly host: HTMLElement,
		private readonly callbacks: GroupPanelCallbacks,
	) {
		this.host.addClass("pm-group-panel");
		this.registerInteraction();
		/*
		 * 拖动排序（仅面板模式会渲染手柄）：监听器注册一次，靠 data-* 委托分发。
		 *
		 * `itemSelector` 给两项是有意的：**不分组时拖卡片、分组时拖分组**（用户口径 2026-09-21）。
		 * `closest` 取最近的匹配祖先，所以判别不是靠选择器算术，而是靠手柄挂在哪：
		 * 卡片上的手柄 → 卡片；分组头上的手柄 → 整个分组。
		 * 落盘分别走 onReorderProjects（组内项目）与 onReorderGroups（分组顺序）。
		 */
		this.dragReorder = new DragReorder(component, this.host, {
			itemSelector: ".pm-card[data-key], .pm-group[data-key]",
			handleSelector: "[data-drag-handle]",
			onCommit: (commit) => this.commitDragOrder(commit),
		});
	}

	// ────────────────────────────── 交互（注册一次） ──────────────────────────────

	private registerInteraction(): void {
		this.component.registerDomEvent(this.host, "click", (evt) => this.onClick(evt));
		this.component.registerDomEvent(this.host, "pointerover", (evt) => {
			this.callbacks.onHoverProject(this.linkedPathOf(evt.target));
		});
		this.component.registerDomEvent(this.host, "pointerout", (evt) => {
			if (this.linkedPathOf(evt.target) === null) return;
			if (this.linkedPathOf(evt.relatedTarget) !== null) return;
			this.callbacks.onHoverProject(null);
		});
	}

	private elementOf(target: EventTarget | null): Element | null {
		const win = this.host.ownerDocument.defaultView;
		if (win === null || !(target instanceof win.Element)) return null;
		return target;
	}

	/** 指针所在的联动目标（项目卡片 / 项目行 / 资料行） */
	private linkedPathOf(target: EventTarget | null): string | null {
		const el = this.elementOf(target);
		if (el === null) return null;
		return el.closest("[data-path]")?.getAttribute("data-path") ?? null;
	}

	private onClick(evt: MouseEvent): void {
		// 手柄上的按下-抬起会被浏览器补发 click，不拦会拖完顺带打开笔记/折叠分组
		if (this.dragReorder.consumeDragClick()) return;
		const el = this.elementOf(evt.target);
		if (el === null) return;

		// 顺序即优先级：更靠近指针的先命中（closest 从目标向上找）
		const expand = el.closest("[data-expand]")?.getAttribute("data-expand");
		if (expand !== null && expand !== undefined) {
			evt.preventDefault();
			this.toggleExpanded(expand);
			return;
		}
		const open = el.closest("[data-open-path]")?.getAttribute("data-open-path");
		if (open !== null && open !== undefined) {
			evt.preventDefault();
			this.callbacks.onOpenNote(open);
			return;
		}
		const toggle = el.closest("[data-toggle-group]")?.getAttribute("data-toggle-group");
		if (toggle !== null && toggle !== undefined) {
			evt.preventDefault();
			this.callbacks.onToggleCollapse(toggle);
			return;
		}
		// 「编辑」按钮：唯一不依赖甘特的入口（长期项目不上图，必须能从面板改）
		const edit = el.closest("[data-edit-path]")?.getAttribute("data-edit-path");
		if (edit !== null && edit !== undefined) {
			evt.preventDefault();
			this.callbacks.onEditProject(edit);
			return;
		}
		// 兜底：点卡片/行的空白处 = 「在甘特里找到它」
		// （用 data-focus-path 而不是 data-path，否则点资料行会拿笔记路径去甘特找）
		const focus = el.closest("[data-focus-path]")?.getAttribute("data-focus-path");
		if (focus !== null && focus !== undefined) {
			this.callbacks.onFocusProject(focus);
		}
	}

	/** 展开/收起资料清单：纯本地 DOM 切换，不必回灌数据再整体重渲染 */
	private toggleExpanded(projectPath: string): void {
		const wrap = this.host.querySelector(
			`.pm-card__notes[data-expand-scope="${cssAttrEscape(projectPath)}"]`,
		);
		if (wrap === null) return;
		const expanded = wrap.classList.toggle("is-expanded");
		const button = wrap.querySelector(".pm-card__expand");
		button?.setText(expanded ? "收起" : (button.getAttribute("data-collapsed-label") ?? "展开全部"));
	}

	/**
	 * 拖动手柄（⠿ 与甘特侧栏同款）：只有面板模式会渲染。
	 *
	 * `kind` 决定它拖动的是什么：**不分组时挂在卡片上**（拖卡片），
	 * **分组时挂在分组头上**（拖分组）——组内卡片的顺序在分组视图里没有意义
	 * （文件夹模式一组往往就一个项目，就一张卡片）。
	 */
	private renderDragHandle(host: HTMLElement, kind: "card" | "group"): void {
		host.createSpan({
			cls: "pm-drag-handle",
			text: "⠿",
			attr: {
				"data-drag-handle": kind,
				"aria-hidden": "true",
				title: kind === "group" ? "拖动调整分组顺序" : "拖动调整卡片顺序",
			},
		});
	}

	/**
	 * 拖动落盘：按**被拖动的项**分流，而不看「现在是哪个分组模式」这类外部状态。
	 *
	 * 状态与 DOM 一旦不同步（例如渲染后模式又被切换），按状态分流会把分组顺序
	 * 当成项目顺序写下去；按被拖动的元素分流则永远与用户手上那一下一致。
	 */
	private commitDragOrder(commit: DragReorderCommit): void {
		if (commit.item.classList.contains("pm-group")) {
			this.callbacks.onReorderGroups(this.renderedGroupOrder());
			return;
		}
		// 组内项目：容器上记着它属于哪个分组，key 交给视图层的既有手动排序
		const groupKey = commit.container
			.closest("[data-group-key]")
			?.getAttribute("data-group-key");
		if (groupKey === null || groupKey === undefined || groupKey.length === 0) return;
		this.callbacks.onReorderProjects(groupKey, commit.keys);
	}

	/**
	 * 屏幕上此刻的分组 key 顺序：快速分区列表 + 普通分组列表，按文档顺序拼起来。
	 *
	 * 两个列表各自可拖，但 manualGroupOrder 里只有**一份** key 表（甘特分节共用同一份），
	 * 所以落盘要给完整顺序。没被拖动的那一份按它当前显示的顺序原样带上即可——
	 * 与甘特侧栏传「全部节 key」是同一口径。
	 */
	private renderedGroupOrder(): string[] {
		const keys: string[] = [];
		for (const list of Array.from(this.host.querySelectorAll("[data-group-list]"))) {
			keys.push(...childKeys(list as HTMLElement));
		}
		return keys;
	}

	// ────────────────────────────── 渲染 ──────────────────────────────

	render(result: GroupingResult, options: GroupPanelRenderOptions): void {
		this.host.empty();

		const ctx: RenderContext = {
			...options,
			quickSet: new Set(result.quickPaths),
			materials: result.materialsByPath,
		};

		if (result.quickGroups.length > 0) {
			const section = this.host.createDiv({ cls: "pm-group-panel__section" });
			section.createEl("h3", { cls: "pm-section-title", text: "⚡ 快速项目" });
			const list = section.createDiv({ cls: "pm-group-list" });
			// 拖动分组时要从这里读回 key 顺序（快速分区与普通分组共用一份分组顺序表）
			list.dataset.groupList = "quick";
			for (const group of result.quickGroups) {
				this.renderGroup(list, toRenderable(group), ctx);
			}
		}

		if (result.quickGroups.length > 0 && result.normalGroups.length > 0) {
			this.host.createDiv({ cls: "pm-group-panel__divider" });
		}

		/*
		 * 「不分组」模式（用户口径 2026-09-21）：一份扁平列表——不套分组壳、不出分组头，
		 * 一个项目一张卡片（没资料的也照样给卡片，不再降级成紧凑行）。
		 * 快速项目走上面的独立分区，不进这份列表。
		 */
		const flat = options.mode === "none";
		if (result.normalGroups.length > 0) {
			const section = this.host.createDiv({ cls: "pm-group-panel__section" });
			section.createEl("h3", {
				cls: "pm-section-title",
				// 只有值模式才谈得上「分组」；folder 与不分组都是「项目」
				text:
					options.mode === "objective" || options.mode === "area" ? "📋 分组" : "📋 项目",
			});
			/*
			 * 不分组时多挂一个类：这份列表里装的是**项目卡片**（一格 = 一张卡片），
			 * 尺寸该比分组模式小——分组模式的一格里是一整组（可能装好几个项目）。
			 * 见 styles.css 的 `.pm-panel-mode .pm-group-list--flat`（用户口径 2026-09-21）。
			 */
			const list = section.createDiv({
				cls: flat ? "pm-group-list pm-group-list--flat" : "pm-group-list",
			});
			// 分组模式：这份列表里装的是分组，拖动它排分组顺序（不分组时是卡片，见下）
			if (!flat) list.dataset.groupList = "normal";
			for (const group of result.normalGroups) {
				if (flat) {
					// 拖动落盘要知道卡片属于哪个分组（不分组 = 唯一的扁平列表）
					list.dataset.groupKey = group.key;
					for (const project of group.projects) {
						this.renderProjectBox(list, project, ctx, true);
					}
					continue;
				}
				this.renderGroup(list, toRenderable(group), ctx);
			}
		}

		if (result.quickGroups.length === 0 && result.normalGroups.length === 0) {
			this.host.createDiv({ cls: "pm-empty", text: "没有符合当前筛选条件的项目" });
		}
	}

	/** 外部（甘特任务条）悬停时调用：只做临时高亮，不滚动 */
	setLinkedProject(path: string | null): void {
		this.host.querySelectorAll(".is-linked").forEach((el) => el.classList.remove("is-linked"));
		if (path === null) return;
		this.host
			.querySelector(`[data-path="${cssAttrEscape(path)}"]`)
			?.classList.add("is-linked");
	}

	private renderGroup(host: HTMLElement, group: RenderableGroup, ctx: RenderContext): void {
		const collapsed = ctx.collapsedKeys.has(group.key);
		const el = host.createDiv({ cls: `pm-group${collapsed ? " is-collapsed" : ""}` });
		el.dataset.key = group.key;

		/**
		 * 文件夹模式下「一个分组 = 一个项目」：让这个项目直接顶上分组标题。
		 * 否则会出现「官网改版」标题下面又一个「官网改版」框框。
		 * 值分组不合并——分组名（领域/目标）和项目名是两回事，都得留着。
		 */
		const single =
			ctx.mode === "folder" && !group.isQuickGroup && group.projects.length === 1
				? group.projects[0]
				: null;
		if (single !== null && !ctx.quickSet.has(single.file.path)) {
			el.dataset.path = single.file.path;
			// data-path 一直留着（悬停联动要用）；定位钩子只在甘特在场时挂
			if (ctx.canLocateInGantt) el.dataset.focusPath = single.file.path;
		}

		this.renderGroupHead(el, group, single, collapsed, ctx);
		const body = el.createDiv({ cls: `pm-group__body${collapsed ? " is-hidden" : ""}` });
		// 组内卡片拖动排序时，靠它找到自己属于哪个分组
		body.dataset.groupKey = group.key;

		if (single !== null) {
			// 分组名与项目名合并展示，框内不再重复标题
			this.renderProjectBox(body, single, ctx, false);
			return;
		}

		const buckets = splitByKind(group.projects, ctx.quickSet, ctx.materials);

		if (buckets.withMaterials.length > 0) {
			const bucket = body.createDiv({ cls: "pm-group__bucket" });
			bucket.createDiv({ cls: "pm-group__bucket-label", text: "带资料的项目" });
			for (const project of buckets.withMaterials) {
				this.renderProjectBox(bucket, project, ctx, true);
			}
		}

		if (buckets.plain.length > 0) {
			const bucket = body.createDiv({ cls: "pm-group__bucket" });
			// 小标题恒定出现（用户口径 2026-09-20）：只在多个桶并存时才标类型，
			// 会让人分不清「这组就是这类」还是「这类恰好没出现」
			bucket.createDiv({ cls: "pm-group__bucket-label", text: "不带资料的项目" });
			const list = bucket.createEl("ul", { cls: "pm-project-list" });
			for (const project of buckets.plain) {
				this.renderProjectRow(list, project, false, ctx);
			}
		}

		if (buckets.quick.length > 0) {
			const bucket = body.createDiv({ cls: "pm-group__bucket" });
			bucket.createDiv({ cls: "pm-group__bucket-label", text: "快速项目" });
			const list = bucket.createEl("ul", { cls: "pm-project-list" });
			for (const project of buckets.quick) {
				this.renderProjectRow(list, project, true, ctx);
			}
		}
	}

	/** 分组头：拖动手柄 + 折叠开关 + 标题（或项目链接）+ 徽章 */
	private renderGroupHead(
		groupEl: HTMLElement,
		group: RenderableGroup,
		single: ProjectItem | null,
		collapsed: boolean,
		ctx: RenderContext,
	): void {
		const head = groupEl.createEl("button", {
			cls: "pm-group__head",
			attr: {
				type: "button",
				"aria-expanded": String(!collapsed),
				title: collapsed ? "展开（甘特图同步展开）" : "折叠（甘特图同步折叠）",
			},
		});
		head.dataset.toggleGroup = group.key;
		/*
		 * 分组抓手放最前（与卡片抓手同位置规律）。它跟折叠按钮是**两层交互**：
		 * 手柄在 pointerdown 上 stopPropagation + preventDefault，之后浏览器补发的
		 * click 又被 consumeDragClick 吃掉，所以拖完不会顺带把分组折叠掉。
		 */
		if (ctx.panelMode && ctx.mode !== "none") this.renderDragHandle(head, "group");
		head.createSpan({ cls: "pm-chevron", text: collapsed ? "▸" : "▾" });

		const title = head.createSpan({ cls: "pm-group__title" });
		if (single !== null) {
			// 标题即项目链接：用户点分组名就能进项目笔记
			const link = title.createEl("a", {
				cls: "internal-link",
				text: single.file.name,
				href: single.file.path,
			});
			link.dataset.openPath = single.file.path;
		} else {
			title.setText(group.title);
		}

		const badges = head.createSpan({ cls: "pm-group__badges" });
		if (group.warning === "multiple-projects") {
			badges.createSpan({
				cls: "pm-badge pm-badge--warning",
				text: `⚠️ ${group.projects.length} 个项目文档`,
				attr: { title: "该文件夹有多个项目笔记，但没有标记 main-project: true" },
			});
		}
		if (single !== null) {
			this.renderProjectBadges(badges, single);
		} else {
			badges.createSpan({ cls: "pm-badge", text: `${group.projects.length} 个项目` });
		}
	}

	// ────────────────────────────── 项目 ──────────────────────────────

	/** 带资料的项目：独立框框（进度 / 资料清单 / 日期） */
	private renderProjectBox(
		host: HTMLElement,
		project: ProjectItem,
		ctx: RenderContext,
		showTitle: boolean,
	): void {
		const materials = ctx.materials[project.file.path] ?? [];
		const card = host.createDiv({ cls: "pm-card" });
		card.dataset.path = project.file.path;
		if (ctx.panelMode) {
			// 拖动排序的 key：childKeys 从容器直接子节点上读它
			card.dataset.key = project.file.path;
		}
		if (ctx.canLocateInGantt) {
			card.dataset.focusPath = project.file.path;
			card.setAttribute("title", "点击在甘特图中定位");
		}

		/*
		 * 「不会出现在甘特图上」的项目（长期 / 缺日期）用底色区分出来，悬停可见原因
		 * （口径来自甘特模型的 skipped，规则怎么变这里自动跟上）。
		 * 底色只做区分，不做禁用态：编辑、拖动、资料清单照常可用。
		 * 注意 title 会覆盖上面的「点击定位」——被跳过的项目点了也定位不到（只会弹解释），
		 * 悬停文案与它保持一致才不自相矛盾。
		 */
		const skipReason = ctx.notOnGantt.get(project.file.path);
		if (skipReason !== undefined) {
			card.addClass("pm-card--off-gantt");
			card.setAttribute("title", GANTT_SKIP_MESSAGES[skipReason]);
		}

		const head = card.createDiv({ cls: "pm-card__head" });
		/*
		 * 抓手只挂在不分组模式：**分组时被拖动的单位是分组本身**，不是里面的卡片
		 * （用户口径 2026-09-21）。分组视图下拖组内卡片没有意义——文件夹模式一组
		 * 往往只有一个项目，也就是只有一张卡片。
		 */
		if (ctx.panelMode && ctx.mode === "none") this.renderDragHandle(head, "card");
		if (showTitle) {
			const title = head.createEl("h4", { cls: "pm-card__title" });
			const link = title.createEl("a", {
				cls: "internal-link",
				text: project.file.name,
				href: project.file.path,
			});
			link.dataset.openPath = project.file.path;
		}
		const badges = head.createDiv({ cls: "pm-card__badges" });
		this.renderProjectBadges(badges, project);
		this.renderEditButton(head, project);

		if (project.progress !== null) {
			const track = card.createDiv({ cls: "pm-progress" });
			const fill = track.createDiv({ cls: "pm-progress__fill" });
			fill.style.setProperty("--pm-progress", `${clampPercent(project.progress)}%`);
		}

		this.renderMaterials(card, project, materials, ctx.maxNotes);
		card.createDiv({ cls: "pm-card__date", text: formatDateRange(project) });
	}

	/** 不带资料 / 快速项目：紧凑列表行 */
	private renderProjectRow(
		list: HTMLElement,
		project: ProjectItem,
		quick: boolean,
		ctx: RenderContext,
	): void {
		const row = list.createEl("li", { cls: "pm-project-row" });
		row.dataset.path = project.file.path;
		if (ctx.canLocateInGantt) {
			row.dataset.focusPath = project.file.path;
			row.setAttribute("title", "点击在甘特图中定位");
		}

		if (project.color !== null) {
			const dot = row.createSpan({ cls: "pm-color-dot" });
			// 与甘特条同口径：直接写颜色，不经过自定义属性中转（那层解析不出来）
			dot.style.backgroundColor = project.color;
		}
		if (quick) {
			row.createSpan({
				cls: "pm-project-row__quick",
				text: "⚡",
				attr: { title: "快速项目：没有自己的项目文件夹，资料直接放在快速项目文件夹里" },
			});
		}

		const link = row.createEl("a", {
			cls: "internal-link pm-project-row__name",
			text: project.file.name,
			href: project.file.path,
		});
		link.dataset.openPath = project.file.path;

		const meta = row.createSpan({ cls: "pm-project-row__meta" });
		this.renderProjectBadges(meta, project);
		if (project.dueDate !== null) {
			meta.createSpan({ cls: "pm-project-row__date", text: project.dueDate });
		}
		this.renderEditButton(meta, project);
		void ctx;
	}

	/**
	 * 「编辑」按钮。
	 *
	 * **一直挂着，不只在面板模式**：长期项目按设计不上甘特图，而其它编辑入口
	 * （甘特侧栏按钮 / 右键菜单 / F2）全都在甘特上——不挂它，这类项目在两种模式下
	 * 都没有界面入口，只能去笔记里手改 frontmatter（用户口径 2026-09-20）。
	 */
	private renderEditButton(host: HTMLElement, project: ProjectItem): void {
		const button = host.createEl("button", {
			cls: "pm-edit-btn",
			text: "编辑",
			attr: { type: "button", "aria-label": `编辑项目 ${project.file.name}` },
		});
		button.dataset.editPath = project.file.path;
	}

	private renderProjectBadges(host: HTMLElement, project: ProjectItem): void {
		if (project.priority !== null) {
			host.createSpan({
				cls: "pm-badge",
				text: PRIORITY_EMOJI[project.priority] ?? project.priority,
			});
		}
		if (project.status !== null) {
			host.createSpan({
				cls: `pm-badge pm-badge--${project.status}`,
				text: statusEmoji(project.status),
			});
		}
	}

	/**
	 * 资料/笔记清单（递归归集的结果，见 grouping-service）。
	 *
	 * 超出 previewCount 的条目**照常渲染但默认隐藏**，由「展开全部」就地切换——
	 * 不走「重新取数 + 整体重渲染」，所以展开是瞬时的，也不会丢滚动位置。
	 */
	private renderMaterials(
		card: HTMLElement,
		project: ProjectItem,
		materials: NoteLink[],
		previewCount: number,
	): void {
		const wrap = card.createDiv({ cls: "pm-card__notes" });
		wrap.dataset.expandScope = project.file.path;
		wrap.createDiv({
			cls: "pm-card__count",
			text: `📝 ${materials.length} 个资料/笔记`,
			attr: { title: "该项目文件夹及其子文件夹里的普通笔记（不含项目文档本身）" },
		});

		if (materials.length === 0) {
			wrap.createDiv({ cls: "pm-card__notes-empty", text: "暂无资料" });
			return;
		}

		const limit = previewCount === 0 ? materials.length : previewCount;
		const rendered = materials.slice(0, MATERIAL_RENDER_CAP);
		const list = wrap.createEl("ul", { cls: "pm-card__list" });
		rendered.forEach((note, index) => {
			const li = list.createEl("li", { cls: "pm-card__list-item" });
			if (index >= limit) li.addClass("is-overflow");
			li.dataset.path = note.path;
			const link = li.createEl("a", {
				cls: "internal-link",
				text: note.name,
				href: note.path,
			});
			link.dataset.openPath = note.path;
		});

		if (rendered.length > limit) {
			const hidden = rendered.length - limit;
			const button = wrap.createEl("button", {
				cls: "pm-card__expand",
				text: `展开全部（还有 ${hidden} 条）`,
				attr: { type: "button" },
			});
			button.dataset.expand = project.file.path;
			// 收起时的文案在这里存一份，切换时直接取回，不必重建节点
			button.setAttribute("data-collapsed-label", `展开全部（还有 ${hidden} 条）`);
		}
		if (materials.length > rendered.length) {
			wrap.createDiv({
				cls: "pm-card__notes-empty",
				text: `另有 ${materials.length - rendered.length} 条未列出（超过单次渲染上限）`,
			});
		}
	}
}

// ────────────────────────────── 内部工具 ──────────────────────────────

interface RenderContext extends GroupPanelRenderOptions {
	quickSet: Set<string>;
	materials: Record<string, NoteLink[]>;
}

function toRenderable(group: QuickGroup | NormalGroup): RenderableGroup {
	if ("folder" in group) {
		return {
			key: group.folder,
			title: group.title,
			projects: group.projects,
			isQuickGroup: true,
		};
	}
	return {
		key: group.key,
		title: group.title,
		projects: group.projects,
		isQuickGroup: false,
		warning: group.warning,
	};
}

function statusEmoji(status: ProjectStatus | null): string {
	return status === null ? "❔" : (STATUS_EMOJI[status] ?? status);
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function formatDateRange(item: ProjectItem): string {
	const { startDate, dueDate } = item;
	if (startDate !== null && dueDate !== null) return `📅 ${startDate} ~ ${dueDate}`;
	if (startDate !== null) return `📅 ${startDate} 起`;
	if (dueDate !== null) return `📅 ${dueDate} 止`;
	return "📅 日期未设置";
}

/** 供属性选择器使用的最小转义（路径可能含引号/反斜杠） */
function cssAttrEscape(value: string): string {
	return value.replace(/["\\]/g, "\\$&");
}
