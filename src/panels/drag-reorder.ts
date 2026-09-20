import { Component } from "obsidian";

/**
 * 列表拖动排序（用户要求 2026-09-20）—— 指针事件实现，零依赖。
 *
 * 为什么不用 HTML5 拖放：`dragstart/dragover/drop` 在 Electron 里会被宿主的
 * 文件拖放处理器干扰（往编辑器里拖文件会插附件），而且拖放期间无法给出实时重排反馈。
 * 指针事件能一边拖一边真实移动节点，用户看到的就是最终结果。
 *
 * 与甘特视图同一套事件模型：**监听器只在构造时注册一次**（挂在宿主的根容器与
 * ownerDocument 上），之后靠 `data-drag-handle` / `data-key` 委托分发。
 * 面板每次刷新都会重建子节点，如果按元素注册监听器，刷新 N 次就漏 N 批。
 *
 * 交互细节（都是踩过的坑）：
 * - 手柄上 `preventDefault + stopPropagation`：否则拖完会顺带触发「点击折叠分组」；
 * - 中途 Esc / pointercancel → 按记录的原始顺序还原，不留半截状态；
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
	/** 拖动前的子节点顺序，用于还原 */
	origin: HTMLElement[];
	moved: boolean;
}

export class DragReorder {
	private state: DragState | null = null;
	/**
	 * 手柄上刚发生过一次按下-抬起。
	 * 浏览器在 pointerup 之后必定补发 click，而手柄位于可点击的分组头内部，
	 * 不拦掉就会「拖完顺带把分组折叠了」。调用方在 click 里先问一次这里。
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

		// 拦掉默认行为与冒泡：手柄在分组头内部，不拦会连带触发「折叠分组」
		evt.preventDefault();
		evt.stopPropagation();

		this.state = {
			item: item as HTMLElement,
			container,
			origin: Array.from(container.children) as HTMLElement[],
			moved: false,
		};
		item.classList.add("is-dragging");
		this.host.addClass("is-reordering");
	}

	private onMove(evt: PointerEvent): void {
		const state = this.state;
		if (state === null) return;
		state.moved = true;

		const siblings = Array.from(state.container.children).filter(
			(child) => child !== state.item,
		);
		const target = siblings.find((child) => {
			const rect = child.getBoundingClientRect();
			return evt.clientY < rect.top + rect.height / 2;
		});
		if (target === undefined) {
			state.container.appendChild(state.item);
		} else {
			state.container.insertBefore(state.item, target);
		}
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
		// 手柄上的按下-抬起一律算拖动操作，即使没移动也不该触发分组的折叠
		this.dragClickPending = true;
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
		this.restore(state);
	}

	private restore(state: DragState): void {
		for (const child of state.origin) {
			state.container.appendChild(child);
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
