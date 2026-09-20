import { Component } from "obsidian";
import {
	GroupingResult,
	NormalGroup,
	NoteLink,
	QuickGroup,
	splitByKind,
} from "../services/grouping-service";
import { GroupingMode, PRIORITY_EMOJI, ProjectItem, STATUS_EMOJI, ProjectStatus } from "../types";

/**
 * 分组面板（SPEC §4 F3 + 用户口径 2026-09-18）—— 规则全部来自 grouping-service，这里只画与转发交互。
 *
 * ── 结构：两层，与甘特图一一对应 ──────────────────────────────────────
 *   分组（分组名 + 折叠开关）
 *     └─ 项目
 * 甘特图就是「分节 → 任务条」两层，面板照抄这个结构，`key` 与甘特分节完全一致，
 * 所以折叠、定位、悬停高亮都能靠同一个 key 对上。
 *
 * ── 组内分桶：先看「快速项目」，再看「有没有资料」 ────────────────────
 *   · 带资料的项目 → 各自一个独立框框（有进度、资料清单、日期、操作）
 *   · 不带资料的项目 → 一个紧凑列表（只有名字、徽章、日期、操作）
 *   · 快速项目 → 另一个紧凑列表（⚡ 标记；它没有自己的文件夹，因而不可能有资料）
 * 只有一个桶非空时不显示桶标题——文件夹分组下「一个分组一个项目」是最常见的情况，
 * 多一层标题纯属噪音；而文件夹模式下这个唯一项目会直接顶上分组标题，
 * 避免「分组名」和「项目名」明明是同一个词却出现两次。
 *
 * 值分组（按目标/领域）下这几桶会同时出现，桶标题才有意义。
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
}

export interface GroupPanelRenderOptions {
	mode: GroupingMode;
	/** 每个项目展示的资料条数上限（0 = 不限） */
	maxNotes: number;
	collapsedKeys: Set<string>;
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
	constructor(
		private readonly component: Component,
		private readonly host: HTMLElement,
		private readonly callbacks: GroupPanelCallbacks,
	) {
		this.host.addClass("pm-group-panel");
	}

	render(result: GroupingResult, options: GroupPanelRenderOptions): void {
		this.host.empty();

		const quickSet = new Set(result.quickPaths);
		const context: RenderContext = {
			...options,
			quickSet,
			materials: result.materialsByPath,
		};

		if (result.quickGroups.length > 0) {
			const section = this.host.createDiv({ cls: "pm-group-panel__section" });
			section.createEl("h3", { cls: "pm-section-title", text: "⚡ 快速项目" });
			const list = section.createDiv({ cls: "pm-group-list" });
			for (const group of result.quickGroups) {
				this.renderGroup(list, toRenderable(group), context);
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
				this.renderGroup(list, toRenderable(group), context);
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

	// ────────────────────────────── 分组 ──────────────────────────────

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

		this.renderGroupHead(el, group, single, collapsed);
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
				this.renderProjectRow(list, project, false);
			}
		}

		if (buckets.quick.length > 0) {
			const bucket = body.createDiv({ cls: "pm-group__bucket" });
			if (showLabels) {
				bucket.createDiv({ cls: "pm-group__bucket-label", text: "快速项目" });
			}
			const list = bucket.createEl("ul", { cls: "pm-project-list" });
			for (const project of buckets.quick) {
				this.renderProjectRow(list, project, true);
			}
		}
	}

	/** 分组头：折叠开关 + 标题（或项目链接）+ 徽章，整行可点折叠 */
	private renderGroupHead(
		groupEl: HTMLElement,
		group: RenderableGroup,
		single: ProjectItem | null,
		collapsed: boolean,
	): void {
		const head = groupEl.createEl("button", {
			cls: "pm-group__head",
			attr: {
				type: "button",
				"aria-expanded": String(!collapsed),
				title: collapsed ? "展开（甘特图同步展开）" : "折叠（甘特图同步折叠）",
			},
		});
		head.createSpan({ cls: "pm-chevron", text: collapsed ? "▸" : "▾" });

		const title = head.createSpan({ cls: "pm-group__title" });
		if (single !== null) {
			// 标题即项目链接：用户点分组名就能进项目笔记
			const link = title.createEl("a", {
				cls: "internal-link",
				text: single.file.name,
				href: single.file.path,
			});
			this.component.registerDomEvent(link, "click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				this.callbacks.onOpenNote(single.file.path);
			});
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
			badges.createSpan({
				cls: "pm-badge",
				text: `${group.projects.length} 个项目`,
			});
		}

		this.component.registerDomEvent(head, "click", () => {
			this.callbacks.onToggleCollapse(group.key);
		});
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
		this.bindHover(card, project.file.path);

		const head = card.createDiv({ cls: "pm-card__head" });
		if (showTitle) {
			const title = head.createEl("h4", { cls: "pm-card__title" });
			const link = title.createEl("a", {
				cls: "internal-link",
				text: project.file.name,
				href: project.file.path,
			});
			this.component.registerDomEvent(link, "click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				this.callbacks.onOpenNote(project.file.path);
			});
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
	private renderProjectRow(list: HTMLElement, project: ProjectItem, quick: boolean): void {
		const row = list.createEl("li", { cls: "pm-project-row" });
		row.dataset.path = project.file.path;
		this.bindHover(row, project.file.path);

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
		this.component.registerDomEvent(link, "click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.callbacks.onOpenNote(project.file.path);
		});

		const meta = row.createSpan({ cls: "pm-project-row__meta" });
		this.renderProjectBadges(meta, project);
		if (project.dueDate !== null) {
			meta.createSpan({ cls: "pm-project-row__date", text: project.dueDate });
		}

		const actions = row.createSpan({ cls: "pm-project-row__actions" });
		this.renderProjectActions(actions, project);
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
		this.component.registerDomEvent(focus, "click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.callbacks.onFocusProject(project.file.path);
		});

		const edit = host.createEl("button", {
			cls: "pm-btn pm-btn--ghost",
			text: "编辑",
			attr: { type: "button", "aria-label": `编辑项目 ${project.file.name}` },
		});
		this.component.registerDomEvent(edit, "click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.callbacks.onEditProject(project.file.path);
		});
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
			this.bindHover(li, note.path);
			const link = li.createEl("a", {
				cls: "internal-link",
				text: note.name,
				href: note.path,
			});
			this.component.registerDomEvent(link, "click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				this.callbacks.onOpenNote(note.path);
			});
		}
		const remaining = materials.length - shown.length;
		if (remaining > 0) {
			wrap.createDiv({ cls: "pm-card__notes-empty", text: `还有 ${remaining} 个…` });
		}
	}

	/** 悬停 → 通知甘特高亮；离开（且没进入另一个联动目标）→ 清空 */
	private bindHover(el: HTMLElement, path: string): void {
		this.component.registerDomEvent(el, "pointerenter", () => {
			this.callbacks.onHoverProject(path);
		});
		this.component.registerDomEvent(el, "pointerleave", (evt) => {
			const related = evt.relatedTarget;
			const win = this.host.ownerDocument.defaultView;
			if (win !== null && related instanceof win.Element) {
				if (related.closest("[data-path]") !== null) return;
			}
			this.callbacks.onHoverProject(null);
		});
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
