import { App, TFile, normalizePath } from "obsidian";
import { FieldMappingConfig } from "../types";

/**
 * 项目写回服务（SPEC §4 F1.4 / F4.1 / F4.3 / F1.7）—— 唯一允许碰用户文件的层。
 *
 * 技能约束（compatibility.md「文件、元数据和并发」）：
 * - frontmatter 一律走 `FileManager.processFrontMatter`：只动自己的字段、保留其他字段；
 * - 正文改动走 `Vault.process`：回调基于**调用时刻的最新内容**做最小改动，不写回旧快照；
 * - 去重与串行：同一文件的并发写由 Obsidian 的原子 API 串行化，本层不缓存任何内容快照；
 * - 路径经 `normalizePath`，并且新建前先查重，绝不静默覆盖已有笔记。
 *
 * 本层不做业务规则（那是 filter/grouping/gantt-model 的事），只做「安全地把值写进文件」。
 */

/** 写操作结果：失败必须有可展示的原因，不抛给 UI 层处理 */
export interface WriteResult {
	ok: boolean;
	/** 成功时为空串；失败时为人类可读原因 */
	message: string;
}

/** Windows 保留设备名（技能 compatibility.md：新建/重命名必须检查） */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 文件名非法字符（Windows 最严格口径，跨平台统一处理） */
const ILLEGAL_CHARS = /[\\/:*?"<>|#^[\]]/g;

/**
 * 笔记标题 → 合法文件名（纯函数）。
 * - 非法字符替换为 `-`（不静默丢弃，用户能看出原名被改过）；
 * - 去掉首尾空白与**尾随的点**（Windows 会静默裁掉尾随点，导致路径与实际不符）；
 * - 保留名（CON/PRN/...）加前缀规避；
 * - 结果为空则退回「新项目」。
 */
export function sanitizeNoteName(raw: string): string {
	let name = raw.trim().replace(ILLEGAL_CHARS, "-");
	// 折叠连续空白，避免文件名里出现不易察觉的多空格
	name = name.replace(/\s+/g, " ").trim();
	// 尾随点/空格在 Windows 上会被文件系统裁掉
	name = name.replace(/[. ]+$/g, "");
	if (name.length === 0) return "新项目";
	if (RESERVED_NAMES.test(name)) return `_${name}`;
	return name;
}

export class ProjectService {
	constructor(private readonly app: App) {}

	/**
	 * 最小改动写 frontmatter（F4.3）。
	 * 值为 `null` 的键表示**删除该字段**（F4.4 清除 type 用这条路径）。
	 */
	async patchFrontmatter(path: string, patch: Record<string, unknown>): Promise<void> {
		const file = this.resolveFile(path);
		if (file === null) return;
		await this.app.fileManager.processFrontMatter(
			file,
			(frontmatter: Record<string, unknown>) => {
				for (const [key, value] of Object.entries(patch)) {
					if (value === null || value === undefined) {
						delete frontmatter[key];
					} else {
						frontmatter[key] = value;
					}
				}
			},
		);
	}

	/**
	 * 标记块替换（F1.7「导出到笔记」）。
	 *
	 * `block` 必须**自带两个标记**（用 mermaid-export 的 `wrapInMarkers()` 拼装），
	 * 本方法会校验这一点：少了标记就报错返回，不会静默把标记抹掉。
	 *
	 * 安全口径：
	 * - 先做一次友好前置检查（用于给出明确错误），真正写入仍在 `Vault.process` 回调里
	 *   **基于最新内容重新校验**——前置检查通过后用户仍可能手改了笔记；
	 * - 标记缺失/顺序颠倒时**原样返回内容**，绝不破坏笔记；
	 * - 只替换标记区域，标记外的正文一字不动。
	 */
	async replaceMarkerBlock(
		path: string,
		block: string,
		startMarker: string,
		endMarker: string,
	): Promise<WriteResult> {
		if (!block.includes(startMarker) || !block.includes(endMarker)) {
			return {
				ok: false,
				message: "内部错误：待写入内容未包含落点标记，已放弃写入（笔记未修改）。",
			};
		}
		const file = this.resolveFile(path);
		if (file === null) {
			return { ok: false, message: `找不到笔记：${path}` };
		}

		const initial = await this.app.vault.read(file);
		const precheck = locateMarkers(initial, startMarker, endMarker);
		if (!precheck.ok) {
			return { ok: false, message: precheck.message };
		}

		const state: { ok: boolean; message: string } = { ok: true, message: "" };
		await this.app.vault.process(file, (content: string) => {
			// 基于最新内容重新定位：期间用户可能已经编辑过
			const located = locateMarkers(content, startMarker, endMarker);
			if (!located.ok) {
				state.ok = false;
				state.message = located.message;
				return content;
			}
			const head = content.slice(0, located.startIndex);
			const tail = content.slice(located.endIndex);
			return `${head}${block}${tail}`;
		});

		if (!state.ok) {
			return { ok: false, message: state.message };
		}
		return { ok: true, message: "" };
	}

	/**
	 * 甘特拖拽写回（F1.4）。
	 *
	 * 「尊重 end_date fallback 设置」的具体口径：
	 * - 该项目原本就是用 `end_date` 当结束日的 → 继续写 `end_date`，不擅自搬家；
	 * - 其余情况（含两边都没有的 start-only 项目）→ 写模板的主字段 `due_date`。
	 *
	 * 判断发生在 `processFrontMatter` 回调内，读的是**最新 frontmatter**，
	 * 而不是 UI 打开时的旧快照（技能：并发回调要基于 current 内容做最小改动）。
	 */
	async writeDates(
		path: string,
		mapping: FieldMappingConfig,
		change: { start?: string; end?: string },
	): Promise<void> {
		const file = this.resolveFile(path);
		if (file === null) return;
		await this.app.fileManager.processFrontMatter(
			file,
			(frontmatter: Record<string, unknown>) => {
				if (change.start !== undefined) {
					frontmatter[mapping.startDate] = change.start;
				}
				if (change.end !== undefined) {
					frontmatter[resolveEndDateField(frontmatter, mapping)] = change.end;
				}
			},
		);
	}

	/**
	 * 新建项目笔记（F4.1）。两种形态由调用方通过 `folderPath` 决定：
	 * - 带文件夹：`folderPath = <扫描目录>/<项目名>` → 项目文档落在自己的文件夹里；
	 * - 快速项目：`folderPath = <扫描目录>` → 项目文档直接放根层（F3.1 的快速项目分区）。
	 *
	 * 先建正文、再用 processFrontMatter 写字段：两步走是刻意的——不手搓 YAML 序列化，
	 * 交给 Obsidian 自己的 frontmatter 写入器，中文、数组、日期的引号/转义规则由宿主保证。
	 *
	 * @param extraFolders 额外要建的目录（带文件夹形态下的「资料」子文件夹等）
	 * @returns 新建笔记的路径
	 */
	async createProject(input: {
		folderPath: string;
		title: string;
		patch: Record<string, unknown>;
		extraFolders?: string[];
	}): Promise<string> {
		const folder = normalizePath(input.folderPath.trim());
		await this.ensureFolder(folder);
		for (const extra of input.extraFolders ?? []) {
			await this.ensureFolder(extra);
		}

		const name = sanitizeNoteName(input.title);
		const path = this.uniquePath(folder, name);
		await this.app.vault.create(path, `# ${input.title.trim()}\n`);
		await this.patchFrontmatter(path, input.patch);
		return path;
	}

	/**
	 * 逐级确保目录存在（幂等）。
	 * 不用 `vault.createFolder` 一把梭：它在父目录缺失时的行为随版本而异，
	 * 逐级 getAbstractFileByPath 检查后再建，跨版本稳定且不会重复建。
	 */
	async ensureFolder(path: string): Promise<void> {
		const normalized = normalizePath(path.trim()).replace(/^\/+|\/+$/g, "");
		if (normalized.length === 0 || normalized === ".") return;

		let current = "";
		for (const segment of normalized.split("/")) {
			if (segment.length === 0) continue;
			current = current.length === 0 ? segment : `${current}/${segment}`;
			if (this.app.vault.getAbstractFileByPath(current) !== null) continue;
			await this.app.vault.createFolder(current);
		}
	}

	/** 路径 → TFile（不存在或不是 markdown 返回 null） */
	private resolveFile(path: string): TFile | null {
		const abstract = this.app.vault.getAbstractFileByPath(normalizePath(path));
		return abstract instanceof TFile ? abstract : null;
	}

	/** 找一个不冲突的路径，绝不覆盖已有笔记 */
	private uniquePath(folder: string, name: string): string {
		const build = (suffix: string): string =>
			folder.length > 0 ? `${folder}/${name}${suffix}.md` : `${name}${suffix}.md`;

		let candidate = build("");
		let counter = 2;
		while (this.app.vault.getAbstractFileByPath(candidate) !== null) {
			candidate = build(` ${counter}`);
			counter += 1;
		}
		return candidate;
	}
}

/**
 * 结束日期该写回哪个物理字段（纯函数，F1.4「写回目标尊重 end_date fallback 设置」）。
 *
 * - 原本在用 `end_date` 的项目（due_date 空、end_date 有值）→ 继续写 end_date；
 * - 其余情况 → 写模板主字段 due_date。
 * 这样既不把用户的字段习惯搬走，也能让 start-only 项目落在模板预期的位置。
 */
export function resolveEndDateField(
	frontmatter: Record<string, unknown>,
	mapping: FieldMappingConfig,
): string {
	const dueEmpty = isEmptyValue(frontmatter[mapping.dueDate]);
	const fallbackPresent = !isEmptyValue(frontmatter[mapping.endDateFallback]);
	return dueEmpty && fallbackPresent ? mapping.endDateFallback : mapping.dueDate;
}

/** frontmatter 值是否「为空」（undefined / null / 空串 视为空；0 与 false 不算空） */
export function isEmptyValue(value: unknown): boolean {
	if (value === undefined || value === null) return true;
	if (typeof value === "string") return value.trim().length === 0;
	return false;
}

type MarkerLocation =
	| { ok: true; startIndex: number; endIndex: number }
	| { ok: false; message: string };

/** 定位标记块（纯函数：内容 + 两个标记 → 可替换区间或失败原因） */
export function locateMarkers(
	content: string,
	startMarker: string,
	endMarker: string,
): MarkerLocation {
	const startIndex = content.indexOf(startMarker);
	if (startIndex === -1) {
		return { ok: false, message: `笔记中找不到起始标记「${startMarker}」，未做任何修改。` };
	}
	const endIndex = content.indexOf(endMarker, startIndex + startMarker.length);
	if (endIndex === -1) {
		return { ok: false, message: `笔记中找不到结束标记「${endMarker}」，未做任何修改。` };
	}
	return { ok: true, startIndex, endIndex: endIndex + endMarker.length };
}
