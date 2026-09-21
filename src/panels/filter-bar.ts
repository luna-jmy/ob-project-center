import { Component } from "obsidian";
import { t } from "../i18n";
import {
	AreaMode,
	DateRangePreset,
	DateRangeState,
	FilterState,
	StatusPreset,
	statusPresetLabel,
	detectStatusPreset,
	hasActiveFilter,
	presetToStatuses,
	resolveDateRange,
	toggle,
} from "../services/filter-service";
import {
	PROJECT_STATUSES,
	ProjectMasterSettings,
	ProjectStatus,
	statusLabel,
	SortMode,
} from "../types";
import { todayIso } from "../utils/date";

/**
 * 筛选栏（SPEC §4 F2）—— 视图内 UI，不再依赖 dashboard 笔记 frontmatter 传参。
 *
 * 与现有 dashboard 的差别（这是插件的立身之本之一）：
 * - status 从「三档互斥下拉」升级为「7 状态多选 chips + 三档快捷预设」；
 * - area 从「只能相对当前笔记 include/exclude」升级为「动态候选列表直接多选」，
 *   同时保留 include/exclude 当前领域作为快捷键（对应现有脚本语义）；
 * - 搜索从 Enter/失焦触发改为 300ms 防抖输入即筛；
 * - **时间**分两层（用户要求 2026-09-18）：
 *   ① 区间筛选（预设 + 自定义起止，两个日期选择器**常显**，不是藏在某个模式里）；
 *   ② **年度快捷筛选**（开始年度 / 结束年度），默认已选「开始年度 = 当前年度」，
 *      这是把「项目太多」压下来的主力；选项由数据里的实际年份生成。
 * - 组合状态实时显示 `已筛/总数`，空结果给「清除筛选」。
 *
 * 筛选栏的 DOM 只构建一次，状态变化走 update() 同步——否则输入框会在每次
 * 防抖回调后被重建，光标和输入法候选框会丢（技能：中文 IME 场景要专门照顾）。
 */

export interface FilterBarHost {
	getState(): FilterState;
	getSortMode(): SortMode;
	getSettings(): ProjectMasterSettings;
	/** 动态收集的 area 候选（来自当前索引的全部项目） */
	getAvailableAreas(): string[];
	/** 动态收集的年度候选（开始年度 ∪ 结束年度，新的在前） */
	getAvailableYears(): number[];
	/** 入口上下文笔记的 area（用于「仅当前领域 / 排除当前领域」快捷档） */
	getCurrentAreas(): string[];
	getCounts(): { shown: number; total: number };

	setStatuses(statuses: ProjectStatus[]): void;
	setAreas(areas: string[]): void;
	setAreaMode(mode: AreaMode): void;
	setSearch(keyword: string): void;
	setDateRange(range: DateRangeState): void;
	setStartYear(year: number | null): void;
	setEndYear(year: number | null): void;
	setSortMode(mode: SortMode): void;
	clearFilters(): void;
}

/** 搜索防抖时长（SPEC F2.3） */
const SEARCH_DEBOUNCE_MS = 300;
/** 年度下拉里代表「不限」的值（select 的 value 只能是字符串） */
const ANY_YEAR = "";

export class FilterBar {
	private chipsEl: HTMLElement | null = null;
	private areaChipsEl: HTMLElement | null = null;
	private searchInput: HTMLInputElement | null = null;
	private presetSelect: HTMLSelectElement | null = null;
	private areaModeSelect: HTMLSelectElement | null = null;
	private dateSelect: HTMLSelectElement | null = null;
	private startInput: HTMLInputElement | null = null;
	private endInput: HTMLInputElement | null = null;
	private startYearSelect: HTMLSelectElement | null = null;
	private endYearSelect: HTMLSelectElement | null = null;
	private sortSelect: HTMLSelectElement | null = null;
	private countEl: HTMLElement | null = null;
	private clearBtn: HTMLButtonElement | null = null;
	private searchTimer: number | null = null;

	constructor(
		private readonly component: Component,
		private readonly host: HTMLElement,
		private readonly deps: FilterBarHost,
	) {
		this.build();
		this.component.register(() => this.clearSearchTimer());
	}

	// ────────────────────────────── 构建 ──────────────────────────────

	private build(): void {
		this.host.addClass("pm-filter-bar");

		this.buildStatusGroup();
		this.buildAreaGroup();
		this.buildSearchGroup();
		this.buildDateGroup();
		this.buildYearGroup();
		this.buildSortGroup();
		this.buildSummary();

		this.update();
	}

	private buildStatusGroup(): void {
		const group = this.host.createDiv({ cls: "pm-filter-group pm-filter-group--status" });
		group.createEl("label", { cls: "pm-filter-label", text: t("状态") });

		const presetSelect = group.createEl("select", { cls: "dropdown pm-filter-select" });
		this.presetSelect = presetSelect;
		// 文案写成「隐藏已完成/取消/归档」：默认档还会隐藏取消与归档，
		// 只写「隐藏已完成」的话，用户改完状态找不到项目时联想不到是它（2026-09-21 报的 bug）
		for (const value of ["hide-completed", "completed-only", "all"] as StatusPreset[]) {
			presetSelect.createEl("option", { value, text: statusPresetLabel(value) });
		}
		this.component.registerDomEvent(presetSelect, "change", () => {
			this.deps.setStatuses(presetToStatuses(presetSelect.value as StatusPreset));
		});

		this.chipsEl = group.createDiv({ cls: "pm-chips" });
	}

	private buildAreaGroup(): void {
		const group = this.host.createDiv({ cls: "pm-filter-group pm-filter-group--area" });
		group.createEl("label", { cls: "pm-filter-label", text: t("领域") });

		const modeSelect = group.createEl("select", { cls: "dropdown pm-filter-select" });
		this.areaModeSelect = modeSelect;
		for (const [value, label] of [
			["selected", "选定领域"],
			["include-current", "仅当前领域"],
			["exclude-current", "排除当前领域"],
		] as [AreaMode, string][]) {
			modeSelect.createEl("option", { value, text: label });
		}
		this.component.registerDomEvent(modeSelect, "change", () => {
			this.deps.setAreaMode(modeSelect.value as AreaMode);
		});

		this.areaChipsEl = group.createDiv({ cls: "pm-chips pm-chips--area" });
	}

	private buildSearchGroup(): void {
		const group = this.host.createDiv({ cls: "pm-filter-group pm-filter-group--search" });
		group.createEl("label", { cls: "pm-filter-label", text: t("搜索") });
		const input = group.createEl("input", {
			cls: "pm-filter-input",
			attr: { type: "search", placeholder: "项目名关键字" },
		});
		this.searchInput = input;
		// 输入即筛（300ms 防抖，SPEC F2.3），不再要求 Enter/失焦
		this.component.registerDomEvent(input, "input", () => {
			this.scheduleSearch(input.value);
		});
		this.component.registerDomEvent(input, "keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				this.clearSearchTimer();
				this.deps.setSearch(input.value);
			}
		});
	}

	/**
	 * 日期区间：预设下拉 + **常显**的两个日期选择器。
	 * 日期选择器始终显示当前生效的区间（选「本月」也能看到具体是哪几天），
	 * 手动改任一边即自动切到「自定义区间」——用户不用先切模式再选日期。
	 */
	private buildDateGroup(): void {
		const group = this.host.createDiv({ cls: "pm-filter-group pm-filter-group--date" });
		group.createEl("label", { cls: "pm-filter-label", text: t("日期") });

		const select = group.createEl("select", { cls: "dropdown pm-filter-select" });
		this.dateSelect = select;
		for (const [value, label] of [
			["all", "全部时间"],
			["week", "本周"],
			["month", "本月"],
			["quarter", "本季度"],
			["year", "本年"],
			["custom", "自定义区间"],
		] as [DateRangePreset, string][]) {
			select.createEl("option", { value, text: label });
		}
		this.component.registerDomEvent(select, "change", () => {
			const preset = select.value as DateRangePreset;
			const current = this.deps.getState().dateRange;
			this.deps.setDateRange({ preset, start: current.start, end: current.end });
		});

		const row = group.createDiv({ cls: "pm-date-range" });
		this.startInput = row.createEl("input", {
			cls: "pm-filter-input pm-filter-input--date",
			attr: { type: "date", "aria-label": "区间起始日期" },
		});
		row.createSpan({ cls: "pm-date-sep", text: "~" });
		this.endInput = row.createEl("input", {
			cls: "pm-filter-input pm-filter-input--date",
			attr: { type: "date", "aria-label": "区间结束日期" },
		});

		const commitCustom = (): void => {
			const start = this.startInput?.value ?? "";
			const end = this.endInput?.value ?? "";
			this.deps.setDateRange({
				preset: "custom",
				start: start === "" ? null : start,
				end: end === "" ? null : end,
			});
		};
		if (this.startInput !== null) {
			this.component.registerDomEvent(this.startInput, "change", commitCustom);
		}
		if (this.endInput !== null) {
			this.component.registerDomEvent(this.endInput, "change", commitCustom);
		}
	}

	/** 年度快捷筛选：按项目开始年度 / 结束年度各一个下拉，选项由数据驱动 */
	private buildYearGroup(): void {
		const group = this.host.createDiv({ cls: "pm-filter-group pm-filter-group--year" });
		group.createEl("label", { cls: "pm-filter-label", text: t("年度") });

		const startWrap = group.createDiv({ cls: "pm-year-picker" });
		startWrap.createSpan({ cls: "pm-year-picker__label", text: t("开始") });
		this.startYearSelect = startWrap.createEl("select", {
			cls: "dropdown pm-filter-select",
			attr: { "aria-label": "按项目开始年度筛选" },
		});

		const endWrap = group.createDiv({ cls: "pm-year-picker" });
		endWrap.createSpan({ cls: "pm-year-picker__label", text: t("结束") });
		this.endYearSelect = endWrap.createEl("select", {
			cls: "dropdown pm-filter-select",
			attr: { "aria-label": "按项目结束年度筛选" },
		});

		const startSelect = this.startYearSelect;
		const endSelect = this.endYearSelect;
		this.component.registerDomEvent(startSelect, "change", () => {
			this.deps.setStartYear(parseYearValue(startSelect.value));
		});
		this.component.registerDomEvent(endSelect, "change", () => {
			this.deps.setEndYear(parseYearValue(endSelect.value));
		});
	}

	private buildSortGroup(): void {
		const group = this.host.createDiv({ cls: "pm-filter-group pm-filter-group--sort" });
		group.createEl("label", { cls: "pm-filter-label", text: t("排序") });
		const select = group.createEl("select", { cls: "dropdown pm-filter-select" });
		this.sortSelect = select;
		for (const [value, label] of [
			["due-asc", t("截止日 ↑")],
			["due-desc", t("截止日 ↓")],
			["start-asc", t("开始日 ↑")],
			["start-desc", t("开始日 ↓")],
			["name", t("项目名")],
			["priority", t("优先级")],
			// 拖过分组/项目后会自动切到这一档；想回到自动排序就从这里选别的
			["manual", t("手动排序")],
		] as [SortMode, string][]) {
			select.createEl("option", { value, text: label });
		}
		this.component.registerDomEvent(select, "change", () => {
			this.deps.setSortMode(select.value as SortMode);
		});
	}

	private buildSummary(): void {
		const group = this.host.createDiv({ cls: "pm-filter-group pm-filter-group--summary" });
		this.countEl = group.createDiv({ cls: "pm-filter-count", text: "" });
		const clear = group.createEl("button", {
			cls: "pm-filter-clear",
			text: t("清除筛选"),
			attr: { type: "button", title: t("清除全部筛选条件，显示所有项目") },
		});
		this.clearBtn = clear;
		this.component.registerDomEvent(clear, "click", () => this.deps.clearFilters());
	}

	// ────────────────────────────── 同步 ──────────────────────────────

	/** 状态变化后调用：只同步，不重建 DOM */
	update(): void {
		const state = this.deps.getState();
		const settings = this.deps.getSettings();
		const today = todayIso();

		this.syncChips(this.chipsEl, buildStatusChips(state, settings), (value) => {
			this.deps.setStatuses(toggle(state.statuses, value as ProjectStatus));
		});

		this.syncChips(this.areaChipsEl, buildAreaChips(state, this.deps), (value) => {
			this.deps.setAreas(toggle(state.areas, value));
		});

		if (this.presetSelect !== null) {
			this.presetSelect.value = detectStatusPreset(state.statuses);
		}
		if (this.areaModeSelect !== null) {
			this.areaModeSelect.value = state.areaMode;
		}
		if (this.dateSelect !== null) {
			this.dateSelect.value = state.dateRange.preset;
		}
		this.syncDateInputs(state.dateRange, today);
		this.syncYearSelect(this.startYearSelect, state.startYear, this.deps.getAvailableYears(), "不限开始年度");
		this.syncYearSelect(this.endYearSelect, state.endYear, this.deps.getAvailableYears(), "不限结束年度");

		if (this.sortSelect !== null) {
			this.sortSelect.value = this.deps.getSortMode();
		}
		if (this.searchInput !== null && this.searchInput.value !== state.search) {
			this.searchInput.value = state.search;
		}

		const counts = this.deps.getCounts();
		if (this.countEl !== null) {
			this.countEl.setText(`${counts.shown}/${counts.total} 个项目`);
			this.countEl.toggleClass("pm-filter-count--empty", counts.shown === 0);
		}
		this.clearBtn?.toggleClass(
			"is-hidden",
			!hasActiveFilter(state, today, settings.defaultYearFilter),
		);
	}

	/** 把生效区间回填到两个日期选择器（正在编辑的那个不动，避免打断输入） */
	private syncDateInputs(range: DateRangeState, today: string): void {
		const effective =
			range.preset === "custom"
				? { start: range.start, end: range.end }
				: resolveDateRange(range.preset, today);
		const doc = this.host.ownerDocument;
		for (const [input, value] of [
			[this.startInput, effective.start],
			[this.endInput, effective.end],
		] as [HTMLInputElement | null, string | null][]) {
			if (input === null) continue;
			if (input === doc.activeElement) continue;
			const next = value ?? "";
			if (input.value !== next) input.value = next;
		}
	}

	/** 年度下拉：选项来自数据，但**必须**包含当前选中值，否则 setValue 会静默落空 */
	private syncYearSelect(
		select: HTMLSelectElement | null,
		selected: number | null,
		years: number[],
		anyLabel: string,
	): void {
		if (select === null) return;
		const options = [...years];
		if (selected !== null && !options.includes(selected)) options.unshift(selected);
		options.sort((a, b) => b - a);

		const signature = options.join(",");
		if (select.dataset.signature !== signature) {
			select.empty();
			select.createEl("option", { value: ANY_YEAR, text: anyLabel });
			for (const year of options) {
				select.createEl("option", { value: String(year), text: `${year} 年` });
			}
			select.dataset.signature = signature;
		}
		select.value = selected === null ? ANY_YEAR : String(selected);
	}

	private syncChips(
		host: HTMLElement | null,
		chips: ChipSpec[],
		onToggle: (value: string) => void,
	): void {
		if (host === null) return;
		host.empty();
		for (const chip of chips) {
			const button = host.createEl("button", {
				cls: `pm-chip${chip.active ? " is-active" : ""}`,
				text: chip.label,
				attr: { type: "button", "aria-pressed": String(chip.active) },
			});
			this.component.registerDomEvent(button, "click", () => onToggle(chip.value));
		}
	}

	private scheduleSearch(raw: string): void {
		this.clearSearchTimer();
		const win = this.host.ownerDocument.defaultView;
		if (win === null) return;
		this.searchTimer = win.setTimeout(() => {
			this.searchTimer = null;
			this.deps.setSearch(raw);
		}, SEARCH_DEBOUNCE_MS);
	}

	private clearSearchTimer(): void {
		if (this.searchTimer === null) return;
		this.host.ownerDocument.defaultView?.clearTimeout(this.searchTimer);
		this.searchTimer = null;
	}
}

// ────────────────────────────── 纯函数 ──────────────────────────────

export interface ChipSpec {
	value: string;
	label: string;
	active: boolean;
}

/** 下拉 value → 年度（"" = 不限） */
export function parseYearValue(raw: string): number | null {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	const year = Number(trimmed);
	return Number.isInteger(year) ? year : null;
}

function buildStatusChips(state: FilterState, settings: ProjectMasterSettings): ChipSpec[] {
	const order = settings.statusOrder.length > 0 ? settings.statusOrder : PROJECT_STATUSES;
	return order.map((status) => ({
		value: status,
		label: `${settings.statusEmoji[status] ?? ""} ${statusLabel(status)}`.trim(),
		active: state.statuses.includes(status),
	}));
}

function buildAreaChips(state: FilterState, deps: FilterBarHost): ChipSpec[] {
	// include/exclude 模式不看具体候选，就没必要铺一排 chips
	if (state.areaMode !== "selected") return [];
	return deps.getAvailableAreas().map((area) => ({
		value: area,
		label: area,
		active: state.areas.includes(area),
	}));
}
