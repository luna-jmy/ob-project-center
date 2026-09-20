import { resolveNonWorkingDays } from "../services/holiday-schedule";
import {
	BarDurationMode,
	GroupSectionSpec,
	ProjectItem,
	ProjectMasterSettings,
} from "../types";
import { addDaysIso, diffDaysIso, maxIso, minIso } from "../utils/date";

/**
 * 甘特模型构建（SPEC §4 F1、§2.3）—— 纯函数，零 DOM / 零 Obsidian 依赖。
 *
 * 规则逐条继承 ref/projectGantt.js：
 * - cancelled 默认排除（F1.6，由设置开关控制）；
 * - **长期项目一律不进甘特**（用户口径 2026-09-20，脚本没有这一条）：它没有确定的
 *   时间边界，面板照常显示、图上不给它编造一条「从某天到某天」的条子；
 * - 至少需要一个日期，否则该条目不进甘特（脚本 `if (!projectStart && !projectEnd) return false`）；
 * - 缺 start → end 前 N 天；缺 end → start 后 N 天（脚本硬编码 7 天，此处参数化）；
 * - 分节按 objective，无 objective 落「默认项目」桶；
 * - 仅当分节数 > 1 才输出分节（脚本 `Object.keys(groupedPages).length > 1`）。
 *
 * 兜底只在渲染层生效（SPEC §2.3）：这里返回的 start/end 是**渲染用值**，
 * 同时用 startFallback/endFallback 标记出来，UI 据此提示用户补全真实日期，
 * 写回 frontmatter 时也用这个标记决定该不该落盘（F1.4）。
 */

export interface GanttRow {
	item: ProjectItem;
	/** 渲染区间（已应用 ±N 天兜底） */
	start: string;
	end: string;
	/** start 是兜底推导值（非用户真实数据） */
	startFallback: boolean;
	endFallback: boolean;
	/** 自然日跨度（含首尾，闭区间） */
	calendarDays: number;
	/** 工作日跨度 = 自然日 − 非工作日（周末 / 法定节假日；补班日仍算工作日） */
	workdayDays: number;
	/** bar 上要显示的文字；设置为「不显示」时为 null */
	durationLabel: string | null;
}

export interface GanttSection {
	/** 联动 key（与左侧分组卡片的 key 一致） */
	key: string;
	name: string;
	rows: GanttRow[];
	/** 折叠状态：折叠的分节在图上不占行高，但仍保留在模型里（导出不受影响） */
	collapsed: boolean;
}

export type GanttSkipReason = "cancelled" | "no-dates" | "long-term";

export interface GanttModel {
	sections: GanttSection[];
	/** 扁平渲染顺序（分节内顺序拼接），视图层直接按序出图 */
	rows: GanttRow[];
	/**
	 * 图上是否显示分节头。
	 * 口径：分节数 > 1 **或** 存在折叠分节（折叠时必须能看到分节名，否则行消失了用户不知道去哪了）。
	 * 注意与 Mermaid 导出的口径**不同**：导出只算**可见**分节（折叠的整体不导出），
	 * 那是导出器自己的事，见 mermaid-export.ts。
	 */
	showSectionHeaders: boolean;
	/** 时间轴总范围 */
	rangeStart: string;
	rangeEnd: string;
	/**
	 * 非工作日（周末 + 节假日 − 补班日，升序）。
	 *
	 * 视图层据此在网格之下画灰色列——**为什么必须在自绘甘特图上自己画**：
	 * mermaid 那边的 `excludes` 只能画底带（且画在任务条后面、跨度 >5 年直接放弃），
	 * 而「周末/节假日算不算工作日」这件事在两个渲染器里必须是同一个观感。
	 * 口径由 services/holiday-schedule.ts 统一给出，导出那边用的是同一个函数。
	 */
	nonWorkingDays: string[];
	skipped: { item: ProjectItem; reason: GanttSkipReason }[];
}

export interface GanttModelOptions {
	/**
	 * 分节描述（来自 grouping-service 的 `toSectionSpecs()`）。
	 *
	 * 左面板与甘特吃同一份分组结果 → 「左右联动」从数据层面就成立，
	 * 不靠两套逻辑「尽量保持一致」。省略时退回内置的 objective 分节。
	 */
	sections?: GroupSectionSpec[];
	/**
	 * 强制扩大的时间轴范围（来自筛选栏的日期区间）。
	 * 选了「本月」时，即使项目只覆盖其中几天，时间轴也要铺满整个月——
	 * 否则「筛选区间」和「看到的区间」对不上，恢复缩放也没有明确的落点。
	 * 只取并集：项目范围超出它时以项目为准。
	 */
	axisRange?: { start: string; end: string };
}

/** 无日期的空模型（占位范围用 today..today，避免时间轴除零） */
function emptyModel(today: string): GanttModel {
	return {
		sections: [],
		rows: [],
		showSectionHeaders: false,
		rangeStart: today,
		rangeEnd: today,
		nonWorkingDays: [],
		skipped: [],
	};
}

/**
 * @param items 已过筛选/排序管道的条目（视图层负责 applyFilters + sortProjects）
 * @param settings 视图设置
 * @param today 无条目时的占位日期，注入以便测试
 * @param options.sections 分组服务产出的分节（省略则按 objective 自行分节）
 */
export function buildGanttModel(
	items: ProjectItem[],
	settings: ProjectMasterSettings,
	today: string,
	options: GanttModelOptions = {},
): GanttModel {
	const model = emptyModel(today);
	const fallbackDays = settings.dateFallbackDays;

	for (const item of items) {
		/*
		 * 长期项目（用户口径 2026-09-20）：**一律不上甘特图**，只出现在面板里。
		 *
		 * 这是硬规则，不看有没有日期：长期项目没有确定的时间边界，硬画一条
		 * 「从某天到某天」的条子，等于替它编造一个它并不具备的时间承诺。
		 * 判定放在最前面——哪怕它同时是 cancelled，报出来的原因也该是「长期项目」。
		 */
		if (item.longTerm) {
			model.skipped.push({ item, reason: "long-term" });
			continue;
		}
		if (settings.hideCancelledInGantt && item.status === "cancelled") {
			model.skipped.push({ item, reason: "cancelled" });
			continue;
		}

		const row = resolveRow(item, settings.dateFallback, fallbackDays);
		if (row === null) {
			model.skipped.push({ item, reason: "no-dates" });
			continue;
		}
		model.rows.push(row);
	}

	if (model.rows.length === 0) {
		return model;
	}

	model.sections =
		options.sections !== undefined
			? applySectionSpecs(model.rows, options.sections, settings.mermaidSectionFallback)
			: buildSections(model.rows, settings.mermaidSectionFallback);
	model.showSectionHeaders =
		model.sections.length > 1 || model.sections.some((section) => section.collapsed);

	let rangeStart: string | null = null;
	let rangeEnd: string | null = null;
	for (const row of model.rows) {
		rangeStart = minIso(rangeStart, row.start);
		rangeEnd = maxIso(rangeEnd, row.end);
	}
	if (options.axisRange !== undefined) {
		rangeStart = minIso(rangeStart, options.axisRange.start);
		rangeEnd = maxIso(rangeEnd, options.axisRange.end);
	}
	model.rangeStart = rangeStart ?? today;
	model.rangeEnd = rangeEnd ?? today;
	// 范围定了才知道要铺哪些非工作日（周末要按范围逐日展开）
	model.nonWorkingDays = resolveNonWorkingDays(model.rangeStart, model.rangeEnd, settings);
	applyDurations(model.rows, model.nonWorkingDays, settings.ganttBarDuration);

	return model;
}

/**
 * 按外部分节描述排布行。
 *
 * 两条保护：
 * - 分节里没有任何可上图的条目（全被 cancelled / 缺日期挡掉）→ 该分节整体丢弃，
 *   否则会在图上留一个空标题（左侧卡片仍在，只是点定位不到，属预期）；
 * - 有行没被任何分节认领（理论上不该发生，比如分节来自另一套筛选结果）→
 *   落到末尾的兜底分节，宁可多个标题也不丢数据。
 */
function applySectionSpecs(
	rows: GanttRow[],
	specs: GroupSectionSpec[],
	fallbackName: string,
): GanttSection[] {
	const byPath = new Map<string, GanttRow>();
	for (const row of rows) {
		byPath.set(row.item.file.path, row);
	}

	const claimed = new Set<string>();
	const sections: GanttSection[] = [];
	for (const spec of specs) {
		const sectionRows: GanttRow[] = [];
		for (const path of spec.paths) {
			const row = byPath.get(path);
			if (row === undefined) continue;
			claimed.add(path);
			sectionRows.push(row);
		}
		if (sectionRows.length === 0) continue;
		sections.push({
			key: spec.key,
			name: spec.name,
			rows: sectionRows,
			collapsed: spec.collapsed,
		});
	}

	const orphans = rows.filter((row) => !claimed.has(row.item.file.path));
	if (orphans.length > 0) {
		sections.push({
			key: "__ungrouped__",
			name: fallbackName,
			rows: orphans,
			collapsed: false,
		});
	}
	return sections;
}

/**
 * 建行。
 * 天数信息要等**全局非工作日清单**出来才算得了（`applyDurations`），所以这里先占零值。
 */
function makeRow(
	item: ProjectItem,
	start: string,
	end: string,
	startFallback: boolean,
	endFallback: boolean,
): GanttRow {
	return {
		item,
		start,
		end,
		startFallback,
		endFallback,
		calendarDays: 0,
		workdayDays: 0,
		durationLabel: null,
	};
}

/** 单条目 → 渲染行（无可用日期返回 null） */
function resolveRow(
	item: ProjectItem,
	strategy: ProjectMasterSettings["dateFallback"],
	fallbackDays: number,
): GanttRow | null {
	const { startDate, dueDate } = item;

	if (startDate !== null && dueDate !== null) {
		return makeRow(item, startDate, dueDate, false, false);
	}

	// 缺任一边时是否允许兜底：mark-invalid 策略要求用户自己补全，不合成假日期
	if (strategy === "mark-invalid") {
		return null;
	}

	if (startDate !== null) {
		return makeRow(item, startDate, addDaysIso(startDate, fallbackDays), false, true);
	}
	if (dueDate !== null) {
		return makeRow(item, addDaysIso(dueDate, -fallbackDays), dueDate, true, false);
	}
	return null;
}

/**
 * 算每条的自然日 / 工作日跨度，并按设置生成 bar 上要显示的文字（用户要求 2026-09-20）。
 *
 * 工作日口径**复用同一份非工作日清单**（`resolveNonWorkingDays`：周末开关 + 节假日排期 − 补班日），
 * 也就是导出 mermaid 用的那一份——图上写的天数与导出的 excludes/includes 因此不会各说各话。
 *
 * 数法上不逐日遍历：非工作日清单是**升序**的，直接在区间内数它的成员即可
 * （一年也就百来条），项目跨度再大也不会退化成逐日循环。
 */
function applyDurations(rows: GanttRow[], nonWorkingDays: string[], mode: BarDurationMode): void {
	for (const row of rows) {
		let offDays = 0;
		for (const day of nonWorkingDays) {
			if (day < row.start) continue;
			if (day > row.end) break;
			offDays += 1;
		}
		row.calendarDays = diffDaysIso(row.start, row.end) + 1;
		row.workdayDays = Math.max(0, row.calendarDays - offDays);
		row.durationLabel = durationLabel(mode, row.calendarDays, row.workdayDays);
	}
}

/** bar 上的天数文字（纯函数：口径变了只改这一处，测试也只盯这一处） */
export function durationLabel(
	mode: BarDurationMode,
	calendarDays: number,
	workdayDays: number,
): string | null {
	switch (mode) {
		case "off":
			return null;
		case "calendar":
			return `${calendarDays}天`;
		case "workday":
			return `${workdayDays}工作日`;
	}
}

/**
 * 内置分节：按 objective（缺省落 fallback 桶）。
 * 仅在调用方没给外部分节时使用（纯函数测试、以及不需要与左面板对齐的场景）。
 * 分节顺序 = 成员首次出现顺序（脚本用对象插入序，而条目在进函数前已按 due 升序排过），
 * 因此「最早到期的项目所属 objective」排最前——与现有 dashboard 观感一致。
 */
function buildSections(rows: GanttRow[], fallbackName: string): GanttSection[] {
	const buckets = new Map<string, GanttRow[]>();
	for (const row of rows) {
		const name =
			row.item.objective !== null && row.item.objective.length > 0
				? row.item.objective
				: fallbackName;
		const bucket = buckets.get(name);
		if (bucket === undefined) {
			buckets.set(name, [row]);
		} else {
			bucket.push(row);
		}
	}
	return [...buckets.entries()].map(([name, sectionRows]) => ({
		key: `objective:${name}`,
		name,
		rows: sectionRows,
		collapsed: false,
	}));
}

/** 定位用：扁平顺序里某条目的索引（-1 = 不在甘特中） */
export function rowIndexOf(model: GanttModel, path: string): number {
	return model.rows.findIndex((row) => row.item.file.path === path);
}
