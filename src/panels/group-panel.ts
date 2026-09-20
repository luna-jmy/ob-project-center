import { Component } from "obsidian";
import {
	GroupingResult,
	NormalGroup,
	NoteLink,
	QuickGroup,
	splitByKind,
} from "../services/grouping-service";
import { GroupingMode, PRIORITY_EMOJI, ProjectItem, STATUS_EMOJI, ProjectStatus } from "../types";
import { DragReorder } from "./drag-reorder";

/**
 * 分组面板（SPEC §4 F3 + 用户口径 2026-09-18 / 2026-09-20）—— 规则全部来自
 * grouping-service，这里只画与转发交互。
 *
 * ── 结构：两层，与甘特图一一对应 ──────────────────────────────────────
 *   分组（分组名 + 折叠开关 + 拖动手柄）
 *     └─ 项目（带资料 → 独立框框；不带资料 / 快速项目 → 紧凑列表）
 * `key` 与甘特分节完全一致，所以折叠、定位、悬停高亮、拖动排序都能靠同一个 key 对上。
 *
 * ── 事件模型：全部委托 ───────────────────────────────────────────────
 * 面板每次刷新整体重建，若按元素注册监听器，刷新 N 次就往 Component 上挂 N 批
 * （元素已脱离文档却被监听器表引用着 → 真实泄漏）。所以只在构造时注册一次，
 * 之后靠 data-* 分发：`data-open-path` / `data-focus-path` / `data-edit-path` /
 * `data-toggle-group` / `data-drag-handle`。
 */

export interface GroupPanelCallbacks {
	onOpenNote(path: string): void;
	/** 甘特滚动定位（F3.4） */
	onFocusProject(path: string): void;
	onEditProject(path: string): void;
	/** 折叠/展开分组（key 与甘特分节 key 一致） */
	onToggleCollapse(key: string): void;
	/** 悬停某个项目 → 甘特对应任务条高亮；离开传 null */
	onHoverProject(path: string | null): void;
	/** 拖动分组落盘（同一区块内的新顺序） */
	onReorderGroups(keys: string[]): void;
	/** 拖动组内项目落盘（该分组内项目的完整新顺序） */
	onReorderProjects(groupKey: string, paths: string[]): void;
}

export interface GroupPanelRenderOptions {
	mode: GroupingMode;
	/** 每个项目展示的资料条数上限（0 = 不限） */
	maxNotes: number;
	collapsedKeys: Set<string>;
	/** 是否允许拖动排序（排序档为「手动」或用户刚拖过时都给 true） */
	draggable: boolean;
}

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

		this.dragReorder = new DragReorder(component, this.host, {
			itemSelector: ".pm-group, .pm-card, .pm-project-row",
			handleSelector: "[data-drag-handle]",
			onCommit: ({ keys, container, item }) => this.handleReorderCommit(keys, container, item),
		});

		this.registerInteraction();
	}

	// ────────────────────────────── 交互（注册一次） ──────────────────────────────

	private registerInteraction(): void {
		this.component.registerDomEvent(this.host, "click", (evt) => this.onClick(evt));
		this.component.registerDomEvent(this.host, "contextmenu", (evt) => this.onContextMenu(evt));
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
		if (this.dragReorder.consumeDragClick()) return;
		const el = this.elementOf(evt.target);
		if (el === null) return;

		// 顺序即优先级：更靠近指针的先命中（closest 从目标向上找）
		const open = el.closest("[data-open-path]")?.getAttribute("data-open-path");
		if (open !== null && open !== undefined) {
			evt.preventDefault();
			this.callbacks.onOpenNote(open);
			return;
		}
		const focus = el.closest("[data-focus-path]")?.getAttribute("data-focus-path");
		if (focus !== null && focus !== undefined) {
			evt.preventDefault();
			this.callbacks.onFocusProject(focus);
			return;
		}
		const edit = el.closest("[data-edit-path]")?.getAttribute("data-edit-path");
		if (edit !== null && edit !== undefined) {
			evt.preventDefault();
			this.callbacks.onEditProject(edit);
			return;
		}
		const toggle = el.closest("[data-toggle-group]")?.getAttribute("data-toggle-group");
		if (toggle !== null && toggle !== undefined) {
			evt.preventDefault();
			this.callbacks.onToggleCollapse(toggle);
		}
	}

	/** 右键项目 → 编辑（与甘特一致的交互约定） */
	private onContextMenu(evt: MouseEvent): void {
		const el = this.elementOf(evt.target);
		const card = el?.closest(".pm-card, .pm-project-row") ?? null;
		const path = (card as HTMLElement | null)?.dataset.path;
		if (path === undefined) return;
		evt.preventDefault();
		this.callbacks.onEditProject(path);
	}

	private handleReorderCommit(keys: string[], container: HTMLElement, item: HTMLElement): void {
		if (container.classList.contains("pm-group-list")) {
			this.callbacks.onReorderGroups(keys);
			return;
		}
		// 组内项目：拖动只可能发生在某一个桶里，但落盘要记录**整个分组**的顺序，
		// 否则另一个桶里的项目会因为「记录里没有」而被排到末尾。
		const groupKey = item.closest(".pm-group")?.getAttribute("data-key");
		if (groupKey === null || groupKey === undefined) return;
		const groupEl = item.closest(".pm-group");
		if (groupEl === null) return;
		const order = Array.from(groupEl.querySelectorAll<HTMLElement>("[data-drag-item]"))
			.map((el) => el.dataset.key ?? "")
			.filter((key) => key.length > 0);
		if (order.length === 0) return;
		this.callbacks.onReorderProjects(groupKey, order);
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
			for (const group of result.quickGroups) {
				this.renderGroup(list, toRenderable(group), ctx);
			}
		}

		if (result.quickGroups.length > 0 && result.normalGroups.length > 0) {
			this.host.createDiv({ cls: "pm-group-panel__divider" });
		}

		if (result.normalGroups.length > 0) {
			const section = this.host.createDiv({ cls: "pm-group-panel__section" });
			section.createEl("h3", {
				cls: "pm-section-title",
				text: options.mode === "folder" ? "📋 项目" : "📋 分组",
			});
			const list = section.createDiv({ cls: "pm-group-list" });
			for (const group of result.normalGroups) {
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
		}

		this.renderGroupHead(el, group, single, collapsed, ctx);
		const body = el.createDiv({ cls: `pm-group__body${collapsed ? " is-hidden" : ""}` });

		if (single !== null) {
			// 分组名与项目名合并展示，框内不再重复标题
			this.renderProjectBox(body, single, ctx, false);
			return;
		}

		const buckets = splitByKind(group.projects, ctx.quickSet, ctx.materials);
		// 组内只有一个桶时不加桶标题（文件夹分组下的常态）
		const showLabels =
			[buckets.withMaterials, buckets.plain, buckets.quick].filter((b) => b.length > 0)
				.length > 1;

		if (buckets.withMaterials.length > 0) {
			const bucket = body.createDiv({ cls: "pm-group__bucket" });
			if (showLabels) {
				bucket.createDiv({ cls: "pm-group__bucket-label", text: "带资料的项目" });
			}
			for (const project of buckets.withMaterials) {
				this.renderProjectBox(bucket, project, ctx, true);
			}
		}

		if (buckets.plain.length > 0) {
			const bucket = body.createDiv({ cls: "pm-group__bucket" });
			if (showLabels) {
				bucket.createDiv({ cls: "pm-group__bucket-label", text: "不带资料的项目" });
			}
			const list = bucket.createEl("ul", { cls: "pm-project-list" });
			for (const project of buckets.plain) {
				this.renderProjectRow(list, project, false, ctx);
			}
		}

		if (buckets.quick.length > 0) {
			const bucket = body.createDiv({ cls: "pm-group__bucket" });
			if (showLabels) {
				bucket.createDiv({ cls: "pm-group__bucket-label", text: "快速项目" });
			}
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

		if (ctx.draggable) {
			head.createSpan({
				cls: "pm-drag-handle",
				text: "⠿",
				attr: { "data-drag-handle": "true", "aria-hidden": "true", title: "拖动调整分组顺序" },
			});
		}
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

	/** 带资料的项目：独立框框（进度 / 资料清单 / 日期 / 操作） */
	private renderProjectBox(
		host: HTMLElement,
		project: ProjectItem,
		ctx: RenderContext,
		showTitle: boolean,
	): void {
		const materials = ctx.materials[project.file.path] ?? [];
		const card = host.createDiv({ cls: "pm-card" });
		card.dataset.path = project.file.path;
		card.dataset.key = project.file.path;
		if (ctx.draggable) card.dataset.dragItem = "true";

		const head = card.createDiv({ cls: "pm-card__head" });
		if (ctx.draggable) {
			head.createSpan({
				cls: "pm-drag-handle",
				text: "⠿",
				attr: { "data-drag-handle": "true", "aria-hidden": "true", title: "拖动调整项目顺序" },
			});
		}
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

		if (project.progress !== null) {
			const track = card.createDiv({ cls: "pm-progress" });
			const fill = track.createDiv({ cls: "pm-progress__fill" });
			fill.style.setProperty("--pm-progress", `${clampPercent(project.progress)}%`);
		}

		this.renderMaterials(card, materials, ctx.maxNotes);

		card.createDiv({ cls: "pm-card__date", text: formatDateRange(project) });
		this.renderProjectActions(card.createDiv({ cls: "pm-card__actions" }), project);
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
		row.dataset.key = project.file.path;
		if (ctx.draggable) row.dataset.dragItem = "true";

		if (ctx.draggable) {
			row.createSpan({
				cls: "pm-drag-handle",
				text: "⠿",
				attr: { "data-drag-handle": "true", "aria-hidden": "true", title: "拖动调整顺序" },
			});
		}
		if (project.color !== null) {
			const dot = row.createSpan({ cls: "pm-color-dot" });
			dot.style.setProperty("--pm-dot-color", project.color);
		}
		if (quick) {
			row.createSpan({
				cls: "pm-project-row__quick",
				text: "⚡",
				attr: { title: "快速项目：没有自己的文件夹，资料直接放在扫描目录里" },
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

		this.renderProjectActions(row.createSpan({ cls: "pm-project-row__actions" }), project);
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

	private renderProjectActions(host: HTMLElement, project: ProjectItem): void {
		const focus = host.createEl("button", {
			cls: "pm-btn pm-btn--ghost",
			text: "定位",
			attr: { type: "button", "aria-label": `在甘特中定位 ${project.file.name}` },
		});
		focus.dataset.focusPath = project.file.path;

		const edit = host.createEl("button", {
			cls: "pm-btn pm-btn--ghost",
			text: "编辑",
			attr: { type: "button", "aria-label": `编辑项目 ${project.file.name}` },
		});
		edit.dataset.editPath = project.file.path;
	}

	/** 资料/笔记清单（递归归集的结果，见 grouping-service） */
	private renderMaterials(card: HTMLElement, materials: NoteLink[], maxNotes: number): void {
		const wrap = card.createDiv({ cls: "pm-card__notes" });
		wrap.createDiv({
			cls: "pm-card__count",
			text: `📝 ${materials.length} 个资料/笔记`,
			attr: { title: "该项目文件夹的子文件夹下的普通笔记（不含项目文档本身）" },
		});

		if (materials.length === 0) return;

		const shown = maxNotes === 0 ? materials : materials.slice(0, maxNotes);
		const list = wrap.createEl("ul", { cls: "pm-card__list" });
		for (const note of shown) {
			const li = list.createEl("li", { cls: "pm-card__list-item" });
			li.dataset.path = note.path;
			const link = li.createEl("a", {
				cls: "internal-link",
				text: note.name,
				href: note.path,
			});
			link.dataset.openPath = note.path;
		}
		const remaining = materials.length - shown.length;
		if (remaining > 0) {
			wrap.createDiv({ cls: "pm-card__notes-empty", text: `还有 ${remaining} 个…` });
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
