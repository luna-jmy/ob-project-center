import { ProjectMasterSettings, ProjectStatus } from "../types";
import { GanttModel, GanttRow } from "./gantt-model";

/**
 * Mermaid 导出器（SPEC §4 F1.7）—— 纯函数：视图状态 → mermaid 字符串。
 *
 * 输出格式逐条对齐 ref/projectGantt.js，保证新旧两套方案风格统一、可互相粘贴：
 * - `    title <标题>`（标题可配置，默认「项目进度甘特图」）；
 * - `    dateFormat YYYY-MM-DD` / `    axisFormat %y-%m`；
 * - 仅当分节数 > 1 才输出 `    section <objective>`；
 * - 状态标记：completed → `done, `、active → `active, `，其余无标记；
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
 * @param model 已按筛选/分组/排序产出的甘特模型（F1.7 要求导出的是「当前视图状态」）
 * @param settings 只读取标题配置
 */
export function exportMermaid(model: GanttModel, settings: ProjectMasterSettings): string {
	let code = "```mermaid\ngantt\n";
	code += `    title ${settings.mermaidTitle}\n`;
	code += "    dateFormat YYYY-MM-DD\n";
	code += "    axisFormat %y-%m\n\n";

	// 导出有两条刻意的口径差异（都在测试里固化）：
	// 1. 分节头只看「是否多于一个分节」，不受视图折叠状态影响——导出的是数据，不是当前视图；
	// 2. 折叠分节里的项目照常导出，否则用户折叠一下就以为项目丢了。
	const emitSectionHeaders = model.sections.length > 1;
	const usedIds = new Map<string, number>();
	for (const section of model.sections) {
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

function taskLine(row: GanttRow, usedIds: Map<string, number>): string {
	const id = uniqueId(row.item.file.name, usedIds);
	const cleaned = row.item.file.name.replace(TASK_NAME_STRIP, "");
	const taskName = cleaned.length > 0 ? cleaned : id;
	const marker = statusMarker(row.item.status);
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
