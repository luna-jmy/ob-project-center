import { Component } from "obsidian";

/**
 * 列表 / 网格拖动排序（用户要求 2026-09-20）—— 指针事件实现，零依赖。
 *
 * 为什么不用 HTML5 拖放：`dragstart/dragover/drop` 在 Electron 里会被宿主的
 * 文件拖放处理器干扰（往编辑器里拖文件会插附件）。
 *
 * 2026-09-21 重写（用户报：面板模式下「还没松手位置就已经跳了」）：面板模式的卡片
 * 是**网格**布局，旧实现有两个致命伤——
 * 1. 命中判定只看 `clientY` 与兄弟节点的**纵向**中点：横向并排的卡片永远判不对；
 * 2. 每次 pointermove 都把**真实卡片**搬进 DOM，网格立刻重排、光标下的兄弟跟着换位，
 *    于是还没松手卡片就自己来回跳。
 *
 * 现在的标准做法：
 * - 按下时在原位放一个**占位符**撑住布局，真实卡片脱离文档流变成跟随指针的「幽灵」；
 * - 移动时只挪占位符：网格重排是确定的、无振荡；命中判定按「离光标中心最近的兄弟」
 *   + 偏移的主导轴（横竖两种布局都能判），插到它前面还是后面由此决定；
 * - 松手时把真实卡片放回占位符的位置，清掉临时样式后照旧按 key 顺序落盘。
 *
 * 交互细节（都是踩过的坑）：
 * - 手柄上 `preventDefault + stopPropagation`：否则拖完会顺带触发「点击打开笔记」；
 * - 中途 Esc / pointercancel → 移除占位符并按原始顺序还原，不留半截状态；
 * - 只在顺序**真的变了**时才回调落盘，避免无意义的设置写入。
 */

export interface DragReorderCommit {
	/** 新的 key 顺序（仅本容器内的项） */
	keys: string[];
	/** 被拖动项所在的容器 */
	container: HTMLElement;
	/** 被拖动的项（调用方据此往上找所属分组等上下文） */
	item: HTMLElement;
}

export interface DragReorderConfig {
	/** 可拖动项的选择器 */
	itemSelector: string;
	/** 拖动手柄的选择器 */
	handleSelector: string;
	onCommit: (commit: DragReorderCommit) => void;
}

interface DragState {
	item: HTMLElement;
	container: HTMLElement;
	/** 撑住原位布局的占位符 */
	placeholder: HTMLElement;
	/** 按下时指针相对卡片左上角的偏移（幽灵跟随用，抓在哪就从哪跟） */
	grabOffsetX: number;
	grabOffsetY: number;
	/** 幽灵的尺寸（按下时锁定，落点判定要用它算幽灵中心） */
	width: number;
	height: number;
	/** 拖动前的子节点顺序，用于还原（不含占位符） */
	origin: HTMLElement[];
	moved: boolean;
}

export class DragReorder {
	private state: DragState | null = null;
	/**
	 * 手柄上刚发生过一次按下-抬起。
	 * 浏览器在 pointerup 之后必定补发 click，而手柄位于可点击的卡片内部，
	 * 不拦掉就会「拖完顺带打开笔记」。调用方在 click 里先问一次这里。
	 */
	private dragClickPending = false;

	constructor(
		private readonly component: Component,
		private readonly host: HTMLElement,
		private readonly config: DragReorderConfig,
	) {
		this.component.registerDomEvent(this.host, "pointerdown", (evt) => this.onDown(evt));
		this.component.registerDomEvent(this.host, "keydown", (evt) => {
			if (evt.key === "Escape") this.cancel();
		});

		const doc = this.host.ownerDocument;
		this.component.registerDomEvent(doc, "pointermove", (evt) => this.onMove(evt));
		this.component.registerDomEvent(doc, "pointerup", () => this.commit());
		this.component.registerDomEvent(doc, "pointercancel", () => this.cancel());
	}

	private elementOf(target: EventTarget | null): Element | null {
		const win = this.host.ownerDocument.defaultView;
		if (win === null || !(target instanceof win.Element)) return null;
		return target;
	}

	private onDown(evt: PointerEvent): void {
		if (evt.button !== 0) return;
		const el = this.elementOf(evt.target);
		if (el === null) return;
		const handle = el.closest(this.config.handleSelector);
		if (handle === null) return;

		const item = handle.closest(this.config.itemSelector);
		const container = item?.parentElement ?? null;
		if (item === null || container === null) return;

		// 拦掉默认行为与冒泡：手柄在卡片内部，不拦会连带触发卡片上的点击行为
		evt.preventDefault();
		evt.stopPropagation();

		const rect = item.getBoundingClientRect();
		// 占位符插入之前先记原始顺序：还原与「顺序是否真的变了」都以这份为准
		const origin = Array.from(container.children) as HTMLElement[];

		const placeholder = item.ownerDocument.createElement("div");
		placeholder.className = "pm-drag-placeholder";
		placeholder.style.width = `${rect.width}px`;
		placeholder.style.height = `${rect.height}px`;
		item.before(placeholder);

		/*
		 * 真实卡片脱离文档流变成幽灵：fixed 定位、锁定原尺寸、不参与命中判定。
		 *
		 * **必须挂到 document.body 上**：`position: fixed` 的参照不是视口，而是最近的
		 * 带 transform 的祖先（工作区容器 / 主题里很常见），留在视图里会让幽灵整体
		 * 偏掉一大截，表现为「鼠标和目标位置对不上」（用户报的 bug）。挂到 body 下
		 * fixed 才真正以视口为参照。用 ownerDocument 的 body，popout 窗口里也对。
		 */
		const ghost = item as HTMLElement;
		ghost.setCssProps({
			position: "fixed",
			left: `${rect.left}px`,
			top: `${rect.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
			margin: "0",
			"z-index": "1000",
			"pointer-events": "none",
		});
		ghost.classList.add("is-dragging", "pm-drag-ghost");
		item.ownerDocument.body.appendChild(ghost);
		this.host.addClass("is-reordering");

		this.state = {
			item: ghost,
			container,
			placeholder,
			grabOffsetX: evt.clientX - rect.left,
			grabOffsetY: evt.clientY - rect.top,
			width: rect.width,
			height: rect.height,
			origin,
			moved: false,
		};
	}

	private onMove(evt: PointerEvent): void {
		const state = this.state;
		if (state === null) return;
		state.moved = true;

		// 幽灵跟随指针：保持按下时抓取点在卡片上的相对位置
		const ghostLeft = evt.clientX - state.grabOffsetX;
		const ghostTop = evt.clientY - state.grabOffsetY;
		state.item.style.left = `${ghostLeft}px`;
		state.item.style.top = `${ghostTop}px`;

		/*
		 * 落点用**幽灵自己的位置**判定，不用指针位置（用户报「目标对不准」）：
		 * 抓手在卡片左上角，指针就落在幽灵的左上角，拿指针去判定会让落点整体偏一格。
		 * 用户看的是「那张卡片落在哪」，判定的就应该是那张卡片。
		 */
		const slot = this.findDropSlot(state, {
			centerX: ghostLeft + state.width / 2,
			centerY: ghostTop + state.height / 2,
		});

		// 只在落点真的变了才动 DOM：每次 pointermove 都重排会让网格抖
		if (slot === null) {
			if (state.container.lastElementChild !== state.placeholder) {
				state.container.appendChild(state.placeholder);
			}
			return;
		}
		if (slot.previousElementSibling !== state.placeholder) {
			state.container.insertBefore(state.placeholder, slot);
		}
	}

	/**
	 * 幽灵该插到哪个兄弟**前面**（返回 null = 落到末尾）。
	 *
	 * 规则是「阅读顺序」而不是「离谁最近」：按 DOM 顺序扫一遍，第一个**排在幽灵之后**
	 * 的兄弟就是落点。同一个网格里「离幽灵最近的中心」经常是上下那格而不是左右那格，
	 * 用它算出来的位置会跟用户看到的对不上。
	 *
	 * 「排在之后」的判定带行带（band）：中心纵向差 ≤ 半个卡高就算同一行，同一行比横向、
	 * 不同行比纵向——网格横排与列表竖排因此都能判对。
	 */
	private findDropSlot(
		state: DragState,
		ghost: { centerX: number; centerY: number },
	): HTMLElement | null {
		for (const child of Array.from(state.container.children)) {
			const sibling = child as HTMLElement;
			if (sibling === state.item || sibling === state.placeholder) continue;
			const rect = sibling.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) continue;
			const centerX = rect.left + rect.width / 2;
			const centerY = rect.top + rect.height / 2;
			const sameRow = Math.abs(ghost.centerY - centerY) <= rect.height / 2;
			const comesAfter = sameRow ? ghost.centerX < centerX : ghost.centerY < centerY;
			if (comesAfter) return sibling;
		}
		return null;
	}

	/** 取走「刚拖过」标记；true 表示这一次 click 应当被忽略 */
	consumeDragClick(): boolean {
		const pending = this.dragClickPending;
		this.dragClickPending = false;
		return pending;
	}

	private commit(): void {
		const state = this.state;
		this.state = null;
		if (state === null) return;

		state.item.classList.remove("is-dragging");
		this.host.removeClass("is-reordering");
		this.dragClickPending = true;

		// 幽灵归位到占位符的位置（它现在挂在 body 上，不是容器的子节点，所以要跨父节点插回）
		state.container.insertBefore(state.item, state.placeholder);
		state.placeholder.remove();
		this.clearGhostStyles(state.item);

		if (!state.moved) return;

		const keys = childKeys(state.container);
		if (keys.length !== state.origin.length || keys.length === 0) {
			// 结构对不上（理论上不会发生）→ 还原，宁可不落盘
			this.restore(state);
			return;
		}
		if (sameOrder(keys, state.origin.map((el) => el.dataset.key ?? ""))) return;
		this.config.onCommit({ keys, container: state.container, item: state.item });
	}

	private cancel(): void {
		const state = this.state;
		this.state = null;
		if (state === null) return;
		state.item.classList.remove("is-dragging");
		this.host.removeClass("is-reordering");
		this.dragClickPending = true;
		this.clearGhostStyles(state.item);
		this.restore(state);
	}

	private restore(state: DragState): void {
		// 占位符不在 origin 里，先移除再按原顺序摆回，否则它会留在容器里
		state.placeholder.remove();
		for (const child of state.origin) {
			state.container.appendChild(child);
		}
	}

	/** 拖动期给幽灵加的都是临时定位样式，结束时逐项清掉，不碰卡片的其他内联样式 */
	private clearGhostStyles(item: HTMLElement): void {
		for (const prop of [
			"position",
			"left",
			"top",
			"width",
			"height",
			"margin",
			"z-index",
			"pointer-events",
		]) {
			item.style.removeProperty(prop);
		}
	}
}

/** 容器内所有可排序项的 key（按当前文档顺序） */
function childKeys(container: HTMLElement): string[] {
	return Array.from(container.children)
		.map((child) => (child as HTMLElement).dataset.key ?? "")
		.filter((key) => key.length > 0);
}

function sameOrder(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}
