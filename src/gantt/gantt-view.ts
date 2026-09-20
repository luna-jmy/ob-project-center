import { Component, Platform } from "obsidian";
import { ZoomMode } from "../types";
import { addDaysIso } from "../utils/date";
import { GanttModel, GanttRow } from "./gantt-model";
import { TimeScale, buildTimeScale } from "./time-scale";

/**
 * 交互式甘特视图（SPEC §4 F1、§6.1、§7）—— 自绘实现。
 *
 * 为什么自绘而不是 frappe-gantt：选型审计不通过（见 M3 审计记录）——
 * 该库用全局 `document` 创建节点，CSS 带 `:root` / `html[data-theme=dark]` 全局选择器与 `!important`，
 * 与 SPEC §6.1「构建产物不得引入全局选择器污染」、§7「popout 窗口 DOM 必须归属正确 ownerDocument」
 * 两条一票否决条款冲突。SPEC §11 已预置该降级路径（D4 fallback 自绘）。
 *
 * 冲突防护要点：
 * - 全部 DOM 挂在调用方给的 `pm-` 前缀根容器内，视觉样式只写进 styles.css；
 * - 图形几何用 SVG 属性（x/width/y/height）表达，而非内联 style——不产生 CSS 污染；
 * - 事件只在构造时注册一次（`Component.registerDomEvent` 自动随生命周期回收），
 *   重渲染只替换子节点，监听器数量恒定不增长；
 * - 一切 createElement 都走 `root.ownerDocument`，popout 窗口安全；
 * - 拖拽在移动端禁用（SPEC §7：移动端降级为 Modal 编辑）。
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * 行高（px）。**必须与 styles.css 里的对应值一致**：
 * 这里是 SVG 坐标计算，CSS 里是盒子高度，两边对不上就会出现条与行错位。
 */
const ROW_HEIGHT = 30;
const SECTION_HEIGHT = 26;
/** 网格线/表头标签的降级阈值（极端范围 + 日刻度时避免一次插入上万节点） */
const MAX_GRID_LINES = 1000;
const MAX_HEADER_LABELS = 240;

export interface GanttCallbacks {
	/** 点击任务条 → 打开笔记（新 leaf，不抢占当前） */
	onOpenNote(path: string): void;
	/** 请求编辑项目（右键 / 侧栏按钮 / 键盘 F2、ContextMenu） */
	onEditProject(path: string): void;
	/** 拖拽落盘：只包含真正被拖动的那一侧 */
	onDatesChanged(path: string, change: { start?: string; end?: string }): void;
	/** 指针进入/离开某条 → 左侧分组卡片同步高亮（左右联动） */
	onHoverProject(path: string | null): void;
	/** 点击甘特的分节头 → 折叠/展开（与左面板同步） */
	onToggleSection(key: string): void;
}

type DragMode = "move" | "resize-start" | "resize-end";

interface DragState {
	mode: DragMode;
	path: string;
	row: GanttRow;
	originX: number;
	originalStart: string;
	originalEnd: string;
	bar: SVGRectElement;
	moved: boolean;
}

/** 侧栏与时间轴共用的纵向布局条目，保证两侧行高严格对齐 */
interface LayoutEntry {
	kind: "section" | "row";
	/** 分节的联动 key（左侧分组卡片用同一个 key，折叠状态靠它对上） */
	sectionKey: string;
	sectionName: string;
	collapsed: boolean;
	row: GanttRow | null;
	y: number;
	height: number;
}

export class GanttView {
	// 持久框架（构造顺序：ensureFrame 只在首次 render 时执行一次）
	private frameBuilt = false;
	private sidebarHeadEl: HTMLElement | null = null;
	private sidebarBodyEl: HTMLElement | null = null;
	private timelineEl: HTMLElement | null = null;
	private canvasEl: HTMLElement | null = null;

	// 每次渲染重建的部分
	private shapesEl: SVGElement | null = null;
	private tooltipEl: HTMLElement | null = null;

	// 渲染状态（只保留渲染与交互真正需要的：缩放由 TimeScale 携带着）
	private scale: TimeScale | null = null;
	private layout: LayoutEntry[] = [];
	private drag: DragState | null = null;
	/**
	 * 拖拽结束后的那一次 click 必须吃掉。
	 * 浏览器在 pointerup 之后一定补发 click，而那时 drag 已经清空，
	 * 不加这个标志就会「拖完顺带把笔记打开」。
	 */
	private suppressNextClick = false;
	private highlightTimer: number | null = null;

	constructor(
		private readonly component: Component,
		private readonly root: HTMLElement,
		private readonly callbacks: GanttCallbacks,
	) {
		this.registerInteraction();
	}

	// ────────────────────────────── 渲染 ──────────────────────────────

	render(model: GanttModel, zoom: ZoomMode, today: string): void {
		this.scale = buildTimeScale(model.rangeStart, model.rangeEnd, zoom, { today });
		this.layout = buildLayout(model);

		this.ensureFrame();
		this.root.toggleClass("pm-gantt--empty", model.rows.length === 0);

		const head = this.sidebarHeadEl;
		const body = this.sidebarBodyEl;
		const canvas = this.canvasEl;
		if (head === null || body === null || canvas === null) return;

		head.setText(`${model.rows.length} 个项目`);
		// 提示挂在 root 上，不受下面两次 empty() 影响，必须显式收掉
		this.hideTooltip();
		body.empty();
		canvas.empty();

		canvas.style.setProperty("--pm-canvas-width", `${this.scale.totalWidth}px`);

		this.renderSidebar(body);
		this.renderHeader(canvas);
		this.renderBody(canvas);

		this.syncScroll();
	}

	/** 只建一次：滚动监听器挂在持久节点上，重渲染不会累积监听器 */
	private ensureFrame(): void {
		if (this.frameBuilt) return;
		this.root.addClass("pm-gantt");

		const sidebar = this.root.createDiv({ cls: "pm-gantt__sidebar" });
		this.sidebarHeadEl = sidebar.createDiv({ cls: "pm-gantt__sidebar-head" });
		this.sidebarBodyEl = sidebar.createDiv({ cls: "pm-gantt__sidebar-body" });

		this.timelineEl = this.root.createDiv({ cls: "pm-gantt__timeline" });
		this.canvasEl = this.timelineEl.createDiv({ cls: "pm-gantt__canvas" });

		this.component.registerDomEvent(this.timelineEl, "scroll", () => this.syncScroll());
		this.frameBuilt = true;
	}

	private renderSidebar(host: HTMLElement): void {
		for (const entry of this.layout) {
			if (entry.kind === "section") {
				this.renderSectionHeader(host, entry);
				continue;
			}
			const row = entry.row;
			if (row === null) continue;

			const rowEl = host.createDiv({ cls: "pm-gantt__sidebar-row" });
			rowEl.dataset.path = row.item.file.path;

			const nameEl = rowEl.createDiv({ cls: "pm-gantt__sidebar-name" });
			const link = nameEl.createEl("a", {
				cls: "internal-link",
				text: row.item.file.name,
				href: row.item.file.path,
			});
			this.component.registerDomEvent(link, "click", (evt) => {
				evt.preventDefault();
				this.callbacks.onOpenNote(row.item.file.path);
			});
			this.component.registerDomEvent(link, "contextmenu", (evt) => {
				evt.preventDefault();
				this.callbacks.onEditProject(row.item.file.path);
			});

			const meta = rowEl.createDiv({ cls: "pm-gantt__sidebar-meta" });
			if (row.startFallback || row.endFallback) {
				meta.createSpan({
					cls: "pm-gantt__fallback-hint",
					text: "缺日期",
					attr: {
						title: "该项目起止日期不完整，甘特图上为推导值；请编辑补全真实日期",
					},
				});
			}
			// 不依赖右键的等价编辑入口（技能可访问性要求）
			const editBtn = meta.createEl("button", {
				cls: "pm-gantt__edit-btn",
				text: "编辑",
				attr: { type: "button", "aria-label": `编辑项目 ${row.item.file.name}` },
			});
			this.component.registerDomEvent(editBtn, "click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				this.callbacks.onEditProject(row.item.file.path);
			});
		}
	}

	/** 分节头：可点击折叠（与左面板共用 key，任一侧折叠另一侧同步） */
	private renderSectionHeader(host: HTMLElement, entry: LayoutEntry): void {
		const header = host.createEl("button", {
			cls: `pm-gantt__sidebar-section${entry.collapsed ? " is-collapsed" : ""}`,
			attr: { type: "button", "aria-expanded": String(!entry.collapsed) },
		});
		// pm-chevron 与分组面板的分组头共用同一份样式，保证两侧箭头观感一致
		header.createSpan({ cls: "pm-chevron", text: entry.collapsed ? "▸" : "▾" });
		header.createSpan({ cls: "pm-gantt__sidebar-section-name", text: entry.sectionName });
		this.component.registerDomEvent(header, "click", (evt) => {
			evt.preventDefault();
			this.callbacks.onToggleSection(entry.sectionKey);
		});
	}

	private renderHeader(host: HTMLElement): void {
		const scale = this.scale;
		if (scale === null) return;
		const header = host.createDiv({ cls: "pm-gantt__header" });
		const upper = header.createDiv({ cls: "pm-gantt__header-row pm-gantt__header-row--upper" });
		const lower = header.createDiv({ cls: "pm-gantt__header-row pm-gantt__header-row--lower" });
		this.fillHeaderRow(upper, scale.upper);
		this.fillHeaderRow(lower, scale.lower);
	}

	private fillHeaderRow(host: HTMLElement, columns: TimeScale["lower"]): void {
		const step = Math.max(1, Math.ceil(columns.length / MAX_HEADER_LABELS));
		columns.forEach((column, index) => {
			const cell = host.createDiv({ cls: "pm-gantt__header-cell" });
			cell.style.setProperty("--pm-cell-width", `${column.width}px`);
			// 抽稀只影响文字，不影响网格对齐
			if (index % step === 0) {
				cell.createSpan({ cls: "pm-gantt__header-label", text: column.label });
			}
		});
	}

	private renderBody(host: HTMLElement): void {
		const scale = this.scale;
		if (scale === null) return;

		const height = Math.max(entryBottom(this.layout), ROW_HEIGHT);
		const svg = this.svg("svg");
		svg.setAttribute("class", "pm-gantt__svg");
		svg.setAttribute("width", String(scale.totalWidth));
		svg.setAttribute("height", String(height));
		svg.setAttribute("role", "img");
		host.appendChild(svg);

		const shapes = this.svg("g");
		svg.appendChild(shapes);
		this.shapesEl = shapes;

		this.renderGrid(shapes, scale, height);

		for (const entry of this.layout) {
			if (entry.kind !== "row" || entry.row === null) continue;
			this.renderRowShapes(shapes, entry.row, entry.y, scale);
		}

		if (scale.todayX !== null) {
			const line = this.svg("line");
			line.setAttribute("class", "pm-gantt__today");
			line.setAttribute("x1", String(scale.todayX));
			line.setAttribute("x2", String(scale.todayX));
			line.setAttribute("y1", "0");
			line.setAttribute("y2", String(height));
			shapes.appendChild(line);
		}
	}

	private renderGrid(host: SVGElement, scale: TimeScale, height: number): void {
		if (scale.lower.length > MAX_GRID_LINES) return;
		for (const column of scale.lower) {
			const line = this.svg("line");
			line.setAttribute("class", "pm-gantt__grid-line");
			line.setAttribute("x1", String(column.x));
			line.setAttribute("x2", String(column.x));
			line.setAttribute("y1", "0");
			line.setAttribute("y2", String(height));
			host.appendChild(line);
		}
	}

	private renderRowShapes(host: SVGElement, row: GanttRow, y: number, scale: TimeScale): void {
		const x = scale.xForDate(row.start);
		const width = barWidth(row.start, row.end, scale, x);
		const barY = y + 5;
		const barHeight = ROW_HEIGHT - 10;

		const bar = this.svg("rect");
		bar.setAttribute("class", `pm-gantt__bar ${barClass(row)}`);
		bar.setAttribute("x", String(x));
		bar.setAttribute("y", String(barY));
		bar.setAttribute("width", String(width));
		bar.setAttribute("height", String(barHeight));
		bar.setAttribute("rx", "4");
		bar.dataset.path = row.item.file.path;
		bar.setAttribute("tabindex", "0");
		bar.setAttribute("role", "button");
		bar.setAttribute("aria-label", `${row.item.file.name}：${row.start} 至 ${row.end}`);
		if (row.startFallback || row.endFallback) {
			bar.dataset.fallback = "true";
		}

		const title = this.svg("title");
		title.textContent = `${row.item.file.name}\n${row.start} → ${row.end}`;
		bar.appendChild(title);
		host.appendChild(bar);

		if (row.item.progress !== null && row.item.progress > 0) {
			const progress = this.svg("rect");
			progress.setAttribute("class", "pm-gantt__bar-progress");
			progress.setAttribute("x", String(x));
			progress.setAttribute("y", String(barY));
			progress.setAttribute("width", String((width * row.item.progress) / 100));
			progress.setAttribute("height", String(barHeight));
			progress.setAttribute("rx", "4");
			// 命中测试交给任务条本身，覆盖层只负责显示
			progress.setAttribute("pointer-events", "none");
			host.appendChild(progress);
		}

		// 拖拽手柄：移动端不渲染（SPEC §7 拖拽降级 Modal）
		if (!Platform.isMobile) {
			for (const side of ["start", "end"] as const) {
				const handle = this.svg("rect");
				handle.setAttribute("class", "pm-gantt__handle");
				handle.dataset.path = row.item.file.path;
				handle.dataset.handle = side;
				handle.setAttribute("x", String(side === "start" ? x : x + width - 6));
				handle.setAttribute("y", String(barY));
				handle.setAttribute("width", "6");
				handle.setAttribute("height", String(barHeight));
				host.appendChild(handle);
			}
		}
	}

	/** SVG 元素统一经 ownerDocument 创建（popout 安全） */
	private svg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
		return this.root.ownerDocument.createElementNS(SVG_NS, tag);
	}

	// ────────────────────────────── 交互 ──────────────────────────────

	/**
	 * 监听器只注册这一次。
	 * pointermove/pointerup 挂在视图所属文档上：拖到视图外也能收到，靠 drag 状态短路。
	 */
	private registerInteraction(): void {
		this.component.registerDomEvent(this.root, "pointerdown", (evt) => this.onPointerDown(evt));
		this.component.registerDomEvent(this.root, "click", (evt) => this.onClick(evt));
		this.component.registerDomEvent(this.root, "contextmenu", (evt) => this.onContextMenu(evt));
		this.component.registerDomEvent(this.root, "keydown", (evt) => this.onKeyDown(evt));
		// 悬停联动：用 pointerover/out（会冒泡），一次委托搞定所有条与侧栏行
		this.component.registerDomEvent(this.root, "pointerover", (evt) => {
			this.callbacks.onHoverProject(this.linkedPathOf(evt.target));
		});
		this.component.registerDomEvent(this.root, "pointerout", (evt) => {
			// 只有真正离开一个联动目标时才清空，避免在行内部移动反复闪烁
			if (this.linkedPathOf(evt.target) === null) return;
			if (this.linkedPathOf(evt.relatedTarget) !== null) return;
			this.callbacks.onHoverProject(null);
		});

		const doc = this.root.ownerDocument;
		this.component.registerDomEvent(doc, "pointermove", (evt) => this.onPointerMove(evt));
		this.component.registerDomEvent(doc, "pointerup", (evt) => this.onPointerUp(evt));
		this.component.registerDomEvent(doc, "pointercancel", () => this.cancelDrag());
	}

	/** 指针所在位置对应的联动目标（任务条或侧栏行） */
	private linkedPathOf(target: EventTarget | null): string | null {
		const win = this.root.ownerDocument.defaultView;
		if (win === null || !(target instanceof win.Element)) return null;
		const bar = target.closest(".pm-gantt__bar");
		if (bar !== null) return bar.getAttribute("data-path");
		const row = target.closest(".pm-gantt__sidebar-row");
		return row !== null ? row.getAttribute("data-path") : null;
	}

	/**
	 * 外部（左侧分组卡片）悬停时调用：只做临时高亮，不滚动。
	 * 与 `scrollToProject()` 的定时闪烁是两套视觉：一个是「我在这」，一个是「你指的那个在这」。
	 */
	setLinkedProject(path: string | null): void {
		this.root.querySelectorAll(".is-linked").forEach((el) => el.classList.remove("is-linked"));
		if (path === null) return;
		const bar = this.findBar(path);
		bar?.classList.add("is-linked");
		const row = this.sidebarBodyEl?.querySelector(
			`.pm-gantt__sidebar-row[data-path="${cssAttrEscape(path)}"]`,
		);
		row?.classList.add("is-linked");
	}

	/** 目标元素 → 任务条（跨窗口安全：用根容器所属窗口的构造器判断） */
	private barOf(target: EventTarget | null): SVGRectElement | null {
		const win = this.root.ownerDocument.defaultView;
		if (win === null) return null;
		if (!(target instanceof win.SVGElement)) return null;
		if (!target.classList.contains("pm-gantt__bar")) return null;
		return target as SVGRectElement;
	}

	private onPointerDown(evt: PointerEvent): void {
		if (Platform.isMobile) return; // SPEC §7：移动端不做拖拽
		const win = this.root.ownerDocument.defaultView;
		if (win === null || !(evt.target instanceof win.SVGElement)) return;

		const target = evt.target;
		const isHandle = target.classList.contains("pm-gantt__handle");
		const isBar = target.classList.contains("pm-gantt__bar");
		if (!isHandle && !isBar) return;

		const path = target.dataset.path;
		if (path === undefined) return;
		const row = this.findRow(path);
		if (row === null) return;

		const bar = isBar ? (target as SVGRectElement) : this.findBar(path);
		if (bar === null) return;

		const mode: DragMode = isHandle
			? target.dataset.handle === "start"
				? "resize-start"
				: "resize-end"
			: "move";

		this.drag = {
			mode,
			path,
			row,
			originX: evt.clientX,
			originalStart: row.start,
			originalEnd: row.end,
			bar,
			moved: false,
		};
		evt.preventDefault();
	}

	private onPointerMove(evt: PointerEvent): void {
		const drag = this.drag;
		const scale = this.scale;
		if (drag === null || scale === null) return;

		const deltaDays = Math.round((evt.clientX - drag.originX) / scale.dayWidth);
		if (deltaDays === 0 && !drag.moved) return;
		drag.moved = true;

		const { start, end } = shiftRange(drag, deltaDays);
		// 视觉反馈只改几何属性；数据在 pointerup 才落盘（F1.4：拖拽结束才写回）
		const x = scale.xForDate(start);
		drag.bar.setAttribute("x", String(x));
		drag.bar.setAttribute("width", String(barWidth(start, end, scale, x)));

		this.root.addClass("pm-gantt--dragging");
		this.showTooltip(evt, `${start} → ${end}`);
	}

	private onPointerUp(evt: PointerEvent): void {
		const drag = this.drag;
		const scale = this.scale;
		if (drag === null || scale === null) return;

		const deltaDays = Math.round((evt.clientX - drag.originX) / scale.dayWidth);
		this.hideTooltip();
		this.root.removeClass("pm-gantt--dragging");
		this.drag = null;

		if (!drag.moved || deltaDays === 0) return;
		this.suppressNextClick = true;
		const { start, end } = shiftRange(drag, deltaDays);

		if (drag.mode === "move") {
			this.callbacks.onDatesChanged(drag.path, { start, end });
		} else if (drag.mode === "resize-start") {
			this.callbacks.onDatesChanged(drag.path, { start });
		} else {
			this.callbacks.onDatesChanged(drag.path, { end });
		}
	}

	/** Esc / pointercancel：回滚到原始几何（不落盘） */
	private cancelDrag(): void {
		const drag = this.drag;
		if (drag === null) return;
		this.drag = null;
		this.hideTooltip();
		this.root.removeClass("pm-gantt--dragging");

		const scale = this.scale;
		if (scale === null) return;
		const x = scale.xForDate(drag.originalStart);
		drag.bar.setAttribute("x", String(x));
		drag.bar.setAttribute(
			"width",
			String(barWidth(drag.originalStart, drag.originalEnd, scale, x)),
		);
	}

	private onClick(evt: MouseEvent): void {
		if (this.drag !== null) return; // 拖拽进行中的 click 不触发跳转
		if (this.suppressNextClick) {
			this.suppressNextClick = false;
			return;
		}
		const bar = this.barOf(evt.target);
		if (bar === null) return;
		const path = bar.dataset.path;
		if (path === undefined) return;
		evt.preventDefault();
		this.callbacks.onOpenNote(path);
	}

	private onContextMenu(evt: MouseEvent): void {
		const bar = this.barOf(evt.target);
		if (bar === null) return;
		const path = bar.dataset.path;
		if (path === undefined) return;
		evt.preventDefault();
		this.callbacks.onEditProject(path);
	}

	private onKeyDown(evt: KeyboardEvent): void {
		if (evt.key === "Escape" && this.drag !== null) {
			evt.preventDefault();
			this.cancelDrag();
			return;
		}
		const bar = this.barOf(evt.target);
		if (bar === null) return;
		const path = bar.dataset.path;
		if (path === undefined) return;
		// 键盘等价入口：不依赖右键/拖拽（技能可访问性要求）
		if (evt.key === "Enter" || evt.key === " ") {
			evt.preventDefault();
			this.callbacks.onOpenNote(path);
		} else if (evt.key === "F2" || evt.key === "ContextMenu") {
			evt.preventDefault();
			this.callbacks.onEditProject(path);
		}
	}

	// ────────────────────────────── 定位与联动 ──────────────────────────────

	/**
	 * F3.4：分组面板点击 → 甘特滚动定位并高亮对应任务条。
	 * @returns 是否找到并定位（false = 该项目没上甘特图，例如已取消或缺日期）
	 */
	scrollToProject(path: string): boolean {
		const entry = this.layout.find(
			(item) => item.kind === "row" && item.row?.item.file.path === path,
		);
		const scale = this.scale;
		const timeline = this.timelineEl;
		if (entry === undefined || entry.row === null || scale === null || timeline === null) {
			return false;
		}

		timeline.scrollTop = Math.max(
			0,
			entry.y - timeline.clientHeight / 2 + entry.height / 2,
		);
		const x = scale.xForDate(entry.row.start);
		const width = barWidth(entry.row.start, entry.row.end, scale, x);
		timeline.scrollLeft = Math.max(0, x - timeline.clientWidth / 2 + width / 2);

		this.syncScroll();
		this.highlight(path);
		return true;
	}

	private highlight(path: string): void {
		const bar = this.findBar(path);
		const rowEl = this.sidebarBodyEl?.querySelector<HTMLElement>(
			`.pm-gantt__sidebar-row[data-path="${cssAttrEscape(path)}"]`,
		);
		bar?.classList.add("pm-gantt__bar--highlight");
		rowEl?.classList.add("pm-gantt__sidebar-row--highlight");

		const win = this.root.ownerDocument.defaultView;
		if (win === null) return;
		if (this.highlightTimer !== null) win.clearTimeout(this.highlightTimer);
		this.highlightTimer = win.setTimeout(() => {
			bar?.classList.remove("pm-gantt__bar--highlight");
			rowEl?.classList.remove("pm-gantt__sidebar-row--highlight");
			this.highlightTimer = null;
		}, 1800);
	}

	/** 侧栏纵向跟随时间轴滚动（两侧行高一致，用 transform 对齐） */
	private syncScroll(): void {
		if (this.timelineEl === null || this.sidebarBodyEl === null) return;
		this.sidebarBodyEl.style.setProperty(
			"--pm-sidebar-offset",
			`${-this.timelineEl.scrollTop}px`,
		);
	}

	destroy(): void {
		this.hideTooltip();
		const win = this.root.ownerDocument.defaultView;
		if (this.highlightTimer !== null && win !== null) {
			win.clearTimeout(this.highlightTimer);
		}
		this.highlightTimer = null;
		this.drag = null;
		this.scale = null;
		this.layout = [];
		this.frameBuilt = false;
		this.sidebarHeadEl = null;
		this.sidebarBodyEl = null;
		this.timelineEl = null;
		this.canvasEl = null;
		this.shapesEl = null;
		this.root.empty();
	}

	// ────────────────────────────── 内部工具 ──────────────────────────────

	private findRow(path: string): GanttRow | null {
		for (const entry of this.layout) {
			if (entry.kind === "row" && entry.row?.item.file.path === path) return entry.row;
		}
		return null;
	}

	private findBar(path: string): SVGRectElement | null {
		return (
			this.shapesEl?.querySelector<SVGRectElement>(
				`.pm-gantt__bar[data-path="${cssAttrEscape(path)}"]`,
			) ?? null
		);
	}

	/** 拖拽提示挂在视图根容器内，不用 document.body（SPEC §6.1 禁 body 注入） */
	private showTooltip(evt: PointerEvent, text: string): void {
		if (this.tooltipEl === null) {
			this.tooltipEl = this.root.createDiv({ cls: "pm-gantt__tooltip" });
		}
		this.tooltipEl.setText(text);
		const bounds = this.root.getBoundingClientRect();
		this.tooltipEl.style.setProperty("--pm-tip-x", `${evt.clientX - bounds.left + 12}px`);
		this.tooltipEl.style.setProperty("--pm-tip-y", `${evt.clientY - bounds.top + 12}px`);
	}

	private hideTooltip(): void {
		this.tooltipEl?.remove();
		this.tooltipEl = null;
	}
}

// ────────────────────────────── 纯函数辅助 ──────────────────────────────

function buildLayout(model: GanttModel): LayoutEntry[] {
	const entries: LayoutEntry[] = [];
	let y = 0;
	for (const section of model.sections) {
		if (model.showSectionHeaders) {
			entries.push({
				kind: "section",
				sectionKey: section.key,
				sectionName: section.name,
				collapsed: section.collapsed,
				row: null,
				y,
				height: SECTION_HEIGHT,
			});
			y += SECTION_HEIGHT;
		}
		// 折叠的分节只留标题，不占行高（模型里行还在，导出也不受影响）
		if (section.collapsed) continue;
		for (const row of section.rows) {
			entries.push({
				kind: "row",
				sectionKey: section.key,
				sectionName: section.name,
				collapsed: false,
				row,
				y,
				height: ROW_HEIGHT,
			});
			y += ROW_HEIGHT;
		}
	}
	return entries;
}

function entryBottom(entries: LayoutEntry[]): number {
	const last = entries[entries.length - 1];
	return last === undefined ? 0 : last.y + last.height;
}

function barClass(row: GanttRow): string {
	return row.item.status === null
		? "pm-gantt__bar--unknown"
		: `pm-gantt__bar--${row.item.status}`;
}

/** 条宽：单日任务至少给一个日宽的可见条（闭区间语义） */
function barWidth(start: string, end: string, scale: TimeScale, x: number): number {
	return Math.max(scale.dayWidth, scale.endXForDate(end) - x);
}

/**
 * 拖拽位移 → 新的起止。
 * 约束：start ≤ end（任意一侧被拖过头就夹住，不做跨日翻转）。
 */
function shiftRange(drag: DragState, deltaDays: number): { start: string; end: string } {
	if (drag.mode === "resize-start") {
		const candidate = addDaysIso(drag.originalStart, deltaDays);
		const start = candidate > drag.originalEnd ? drag.originalEnd : candidate;
		return { start, end: drag.originalEnd };
	}
	if (drag.mode === "resize-end") {
		const candidate = addDaysIso(drag.originalEnd, deltaDays);
		const end = candidate < drag.originalStart ? drag.originalStart : candidate;
		return { start: drag.originalStart, end };
	}
	return {
		start: addDaysIso(drag.originalStart, deltaDays),
		end: addDaysIso(drag.originalEnd, deltaDays),
	};
}

/** 供属性选择器使用的最小转义（路径可能含引号/反斜杠） */
function cssAttrEscape(value: string): string {
	return value.replace(/["\\]/g, "\\$&");
}
