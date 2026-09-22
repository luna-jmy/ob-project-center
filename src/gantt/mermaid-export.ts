import { ProjectMasterSettings, ProjectStatus } from "../types";
import { resolveHolidayDates } from "../services/holiday-schedule";
import { isCriticalPriority } from "./bar-colors";
import { GanttModel, GanttRow } from "./gantt-model";

/**
 * Mermaid 导出器（SPEC §4 F1.7）—— 纯函数：视图状态 → mermaid 字符串。
 *
 * 输出格式逐条对齐 ref/projectGantt.js，保证新旧两套方案风格统一、可互相粘贴：
 * - `    title <标题>`（标题可配置，默认「项目进度甘特图」）；
 * - `    dateFormat YYYY-MM-DD` / `    axisFormat %y-%m`；
 * - 仅当分节数 > 1 才输出 `    section <objective>`；
 * - 状态标记：completed → `done, `、active → `active, `，其余无标记；
 * - 关键任务标记：priority 1（最高）/ 2（高）→ `crit, `（用户口径 2026-09-20，脚本无此规则）；
 * - 任务名清洗：去除非中英文数字字符（脚本正则原样沿用）；
 * - 每个分节后留一个空行。
 *
 * 两处**有意偏离**脚本（脚本在此处会产出坏图，属于必须修的缺陷，已在测试中固化）：
 * 1. 任务 ID 去重——脚本直接用「文件名」当 ID，同名项目（不同文件夹）会产生重复 ID，
 *    mermaid 解析器会报错或静默丢条；此处对重复 ID 追加 `-2`、`-3`。
 * 2. 清洗后为空的任务名回退为 ID——纯 emoji/标点文件名清洗后是空字符串，会渲染成空行。
 *
 * 数据方向是单向的（SPEC §1.2）：mermaid 只是导出目标，事实源始终是 frontmatter；
 * 用户手工改笔记里的 mermaid 块不会回流影响插件。
 */

/** 任务名清洗正则（ref/projectGantt.js 原样） */
const TASK_NAME_STRIP = /[^a-zA-Z0-9\u4e00-\u9fa5]/g;

const STATUS_MARKER: Partial<Record<ProjectStatus, string>> = {
	completed: "done, ",
	active: "active, ",
};

function statusMarker(status: ProjectStatus | null): string {
	if (status === null) return "";
	return STATUS_MARKER[status] ?? "";
}

/**
 * 关键任务标记（用户口径 2026-09-20）：priority 1（最高）/ 2（高）→ mermaid 的 `crit`。
 *
 * mermaid 规定标签（`active` / `done` / `crit` / `milestone`）必须写在冒号后的**最前面**、
 * 以逗号分隔，标签之间不区分先后。我们本来就把状态标签放在最前，
 * 所以 `crit` 追加到它前面即可，产物形如：
 *     项目A :crit, done, 项目A, 2026-01-01, 2026-02-01
 *
 * 「哪些算关键任务」的判断放在 gantt/bar-colors，与自绘甘特图给条子描红圈的那一处同源，
 * 免得出现「图上标红了、导出却没有 crit」这类漂移。
 */
function criticalMarker(priority: string | null): string {
	return isCriticalPriority(priority) ? "crit, " : "";
}

/**
 * @param model 已按筛选/分组/排序产出的甘特模型（F1.7 要求导出的是「当前视图状态」）
 * @param settings 只读取标题配置
 */
export function exportMermaid(model: GanttModel, settings: ProjectMasterSettings): string {
	let code = "```mermaid\ngantt\n";
	code += `    title ${settings.mermaidTitle}\n`;
	code += "    dateFormat YYYY-MM-DD\n";
	code += "    axisFormat %y-%m\n";
	for (const directive of buildDirectives(model, settings)) {
		code += `${directive}\n`;
	}
	code += "\n";

	/*
	 * 导出 = **当前视图里看得见的那部分**（用户口径 2026-09-20 修订）。
	 *
	 * 早期口径是「导出的是数据，不是当前视图」，折叠分节也照导；
	 * 实际用起来是反的：用户折叠分节就是为了把不关心的部分收起来，
	 * 导出（尤其「写入笔记」）却把它写回去，等于白折叠。现在：
	 * - 折叠的分节整体不出现（连分节头都不出）；
	 * - 分节头按**可见**分节数判断，只剩一个可见分节时不出 section 行（对齐 projectGantt.js 口径）。
 *
 * 最后这条是**确认过的口径**，不是漏改：2026-09-21 修甘特分节表头时曾问过要不要一并
 * 对齐（让单领域也出 `section 市场`），用户明确回答「只有一个领域 section 的时候
 * mermaid 不显示 section 是对的，不用改」。别顺手改成与甘特一致。
	 */
	const sections = model.sections.filter((section) => !section.collapsed);
	const emitSectionHeaders = sections.length > 1;
	const usedIds = new Map<string, number>();
	for (const section of sections) {
		if (emitSectionHeaders) {
			code += `    section ${section.name}\n`;
		}
		for (const row of section.rows) {
			code += `    ${taskLine(row, usedIds)}\n`;
		}
		code += "\n";
	}

	code += "```";
	return code;
}

/**
 * 这次导出实际会包含的行（折叠分节的行不算）。
 *
 * 给调用方判断「有没有内容可导出」与显示计数用——直接用 `model.rows` 会把
 * 折叠掉的项目也数进去，于是出现「提示说导出了 16 个项目，图里只有 9 条」。
 */
export function exportableRows(model: GanttModel | null): GanttRow[] {
	if (model === null) return [];
	return model.sections
		.filter((section) => !section.collapsed)
		.flatMap((section) => section.rows);
}

/**
 * 导出选项 → mermaid 指令行（用户要求 2026-09-20）。
 * 顺序固定，保证同样的选项产出同样的文本（可被测试逐字比对）。
 *
 * ── 为什么周末与假日必须在**同一条** excludes 里（用户口径 2026-09-22）──
 * mermaid 对 `excludes` 是「后一条覆盖前一条」：`excludes weekends` 与
 * `excludes 2026-10-01` 分成两行时，前一行会被丢掉 —— 表现就是「排除周末开关
 * 看着写了、图上却没灰」。两个来源因此必须并进同一份清单：
 *     excludes weekends,2026-10-01,2026-10-02
 *
 * `excludes` 与 `includes` 的配合（法定节假日 + 调休）：
 * mermaid 的 `includes` 是**优先级最高**的工作日白名单——`isInvalidDate()` 里第一条就是
 * 「命中 includes → 立刻判定为有效日」，所以它能盖过同一行里的 weekends 与具体日期排除。
 * 于是国内日历可以这样表达：
 *     excludes weekends,2026-10-01,2026-10-02   ← 周末 + 法定假日
 *     includes 2026-10-10                        ← 调休补班（那天是周六，但要上班）
 * 被 includes 捞回来的日子不会进图上那条灰色「非工作日」色带。
 * （依据 mermaid 的 gantt.jison 与 ganttRenderer.drawExcludeDays，2026-09-20 核实；
 *   官方文档只写了 excludes，没写 includes。）
 *
 * 日期清单有三个来源，合并后去重升序：
 * 1. **年度排期表**（设置里按年份维护的区间）→ 按图跨越的年份自动套用，这是主力；
 * 2. 面板上的「排除日期」输入（跨年度的临时补充，支持 `A~B` 区间）；
 * 3. 面板上的「调休上班」输入（同上）。
 * 两个清单各自去重、互不覆盖：同一天既在排除又在补班里时，由 mermaid 的优先级裁决。
 */
function buildDirectives(model: GanttModel, settings: ProjectMasterSettings): string[] {
	const lines: string[] = [];
	if (!settings.mermaidTodayMarker) {
		// mermaid 默认就画 today 竖线，所以要「关掉」才输出指令
		lines.push("    todayMarker off");
	}

	const { exclude, include } = resolveHolidayDates(model.rangeStart, model.rangeEnd, settings);
	const excludes = [...(settings.mermaidExcludeWeekends ? ["weekends"] : []), ...exclude];
	if (excludes.length > 0) {
		lines.push(`    excludes ${excludes.join(",")}`);
	}
	if (include.length > 0) {
		lines.push(`    includes ${include.join(",")}`);
	}
	return lines;
}

function taskLine(row: GanttRow, usedIds: Map<string, number>): string {
	const id = uniqueId(row.item.file.name, usedIds);
	const cleaned = row.item.file.name.replace(TASK_NAME_STRIP, "");
	const taskName = cleaned.length > 0 ? cleaned : id;
	// 标签必须写在冒号后的最前面（mermaid 语法），多个标签用逗号分隔
	const marker = `${criticalMarker(row.item.priority)}${statusMarker(row.item.status)}`;
	return `${id} :${marker}${taskName}, ${row.start}, ${row.end}`;
}

/**
 * 唯一 ID：冒号是 mermaid `id :` 语法的分隔符，先去冒号；
 * 再对重复项追加序号后缀。
 */
function uniqueId(name: string, usedIds: Map<string, number>): string {
	const base = name.replace(/:/g, "").trim();
	const safeBase = base.length > 0 ? base : "task";
	const seen = usedIds.get(safeBase);
	if (seen === undefined) {
		usedIds.set(safeBase, 1);
		return safeBase;
	}
	const next = seen + 1;
	usedIds.set(safeBase, next);
	return `${safeBase}-${next}`;
}

/** 供「导出到笔记」拼装：把 fenced 代码块包进落点标记（标记由设置提供） */
export function wrapInMarkers(mermaid: string, settings: ProjectMasterSettings): string {
	return `${settings.mermaidMarkerStart}\n\n${mermaid}\n\n${settings.mermaidMarkerEnd}`;
}
