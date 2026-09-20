import { App, moment, Notice, TFile, normalizePath } from "obsidian";
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

/**
 * 快速项目的落点目录：`<上级目录>/<快速项目标记>`（用户口径 2026-09-20）。
 *
 * 和读取侧的 `isQuickProject()`（grouping-service）是**同一口径的两半**：那边按
 * 「相对路径里有标记段」判定快速项目，这边就按同一规则把新建的快速项目放进标记文件夹。
 * 两边不一致时会出现「设置里那个标记名看起来毫无作用」——新建的快速项目落在扫描目录
 * 根层，提示却说它属于「快速项目」。
 *
 * 两个容错（都是用户在弹窗里手输上级目录会撞到的情形）：
 * - 标记为空（设置页进不来，手改 data.json 有可能）→ 退回上级目录本身，不造空目录名；
 * - 上级目录已经就是标记文件夹 → 不再套一层（避免 `快速项目/快速项目/`）。
 */
export function quickProjectFolder(parent: string, marker: string): string {
	const base = parent.trim().replace(/^\/+|\/+$/g, "");
	const name = marker.trim();
	if (name.length === 0) return base;
	if (base.split("/").pop() === name) return base;
	return base.length === 0 ? name : `${base}/${name}`;
}

/**
 * 用户从 Obsidian「复制路径」粘出来的值 → vault 相对路径（纯函数）。
 *
 * 为什么要做这层清洗：复制出来的东西**不止一种形态**，直接拿去查 vault 会查不到，
 * 而用户完全没法从这个失败里看出原因：
 * - 桌面端复制到的是**绝对路径**（`D:\vault\900 Assets\…`）；
 * - 有些入口给的是**不带扩展名**的路径（`900 Assets/910 Templates/TPL-Project`）；
 * - 复制「链接」拿到的是 wikilink（`[[TPL-Project]]` / `![[TPL-Project|模板]]`）；
 * - 再偶尔夹一层引号或首尾空白。
 *
 * 只做「能收敛就收敛」的清洗，**不做模糊匹配**：找不到就得说找不到，
 * 不能猜一个名字相近的文件出来把用户的模板换掉。
 */
export function toVaultRelativePath(raw: string, vaultBasePath = ""): string {
	let value = raw.trim();
	const link = /^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(value);
	if (link !== null) value = (link[1] ?? "").trim();
	value = value.replace(/^["'`]+|["'`]+$/g, "");

	let path = normalizePath(value);
	// 绝对路径 → 去掉 vault 根前缀。Windows 大小写不敏感，所以只比小写（长度一致，可直接切）
	const base = normalizePath(vaultBasePath.trim());
	if (base.length > 0 && base !== "/") {
		const lowerBase = base.toLowerCase();
		const lowerPath = path.toLowerCase();
		if (lowerPath === lowerBase) path = "";
		else if (lowerPath.startsWith(`${lowerBase}/`)) path = path.slice(base.length + 1);
	}
	return path.replace(/^\/+|\/+$/g, "");
}

/**
 * 模板路径候选：清洗后的相对路径 + 补 `.md` 的那一份（已经带扩展名就不重复）。
 * 调用方按顺序查，第一个存在的就用它。
 */
export function templatePathCandidates(raw: string, vaultBasePath = ""): string[] {
	const relative = toVaultRelativePath(raw, vaultBasePath);
	if (relative.length === 0) return [];
	return relative.toLowerCase().endsWith(".md") ? [relative] : [relative, `${relative}.md`];
}

/** vault 的本地绝对路径（只有桌面端适配器提供；拿不到就返回空串，移动端正常） */
function vaultBasePath(app: App): string {
	const adapter = app.vault.adapter as { getBasePath?(): string };
	if (typeof adapter.getBasePath !== "function") return "";
	try {
		return adapter.getBasePath();
	} catch {
		return "";
	}
}

/**
 * 新建项目的「上级目录」= 设置里的扫描目录 + 可选子文件夹（用户口径 2026-09-20）。
 *
 * 扫描目录在参数里已经写过一遍，不该让用户再手打一次全路径；子文件夹单独一格，
 * 是为了保留「把项目放进中间层目录」的用法（如 `100 Projects/2026工作项目`）。
 * 两段都容忍用户输入的首尾斜杠与空白；都没填就返回空串（= 直接放 vault 根）。
 */
export function resolveParentFolder(scanFolder: string, subFolder: string): string {
	const scan = scanFolder.trim().replace(/^\/+|\/+$/g, "");
	const sub = subFolder.trim().replace(/^\/+|\/+$/g, "");
	if (scan.length === 0) return sub;
	return sub.length === 0 ? scan : `${scan}/${sub}`;
}

/** 核心「模板」插件在用户没改设置时用的日期/时间格式（见其默认设置） */
const CORE_DATE_FORMAT = "YYYY-MM-DD";
const CORE_TIME_FORMAT = "HH:mm";

/**
 * 替换模板里的**核心「模板」插件语法**占位符：`{{title}}` / `{{date}}` / `{{time}}` /
 * `{{date:FORMAT}}` / `{{time:FORMAT}}`（用户口径 2026-09-20 的模板兼容）。
 *
 * 为什么要自己替换：这套语法归 Obsidian 核心的「模板」插件管，而它**只在用户手动插入
 * 模板时**才替换（没有「新建文件时自动套用」这种机制）。我们的笔记是插件直接创建的，
 * 「手动插入」这一步永远不会发生——不替换的话，模板里 `project-id: "{{date:YYYYMM}}"`
 * 会原样留成一串花括号，看起来就像模板没生效。
 *
 * 只替换上面那几种写法，别的 `{{ … }}` 一律不碰（免得误伤正文里的模板变量示例）。
 * 日期格式化由调用方注入（宿主侧传 `moment`），所以这里仍是纯函数、可单测。
 *
 * 已知差异：核心插件允许用户在设置里改「默认日期格式」，那两个值读不到，
 * 这里用它的出厂默认（`YYYY-MM-DD` / `HH:mm`）。写死了格式的 `{{date:…}}` 不受影响。
 */
export function applyCoreTemplateSyntax(
	content: string,
	context: { title: string; format: (format: string) => string },
): string {
	const formatWith = (raw: string | undefined, fallback: string): string => {
		const value = (raw ?? "").trim();
		return context.format(value.length === 0 ? fallback : value);
	};
	return content
		.replace(/\{\{title\}\}/g, context.title)
		.replace(/\{\{date(?::([^}]+))?\}\}/g, (_match, format: string | undefined) =>
			formatWith(format, CORE_DATE_FORMAT),
		)
		.replace(/\{\{time(?::([^}]+))?\}\}/g, (_match, format: string | undefined) =>
			formatWith(format, CORE_TIME_FORMAT),
		);
}

export class ProjectService {
	constructor(private readonly app: App) {}

	/**
	 * 最小改动写 frontmatter（F4.3）。
	 * 值为 `null` 的键表示**删除该字段**（F4.4 清除 type 用这条路径）。
	 *
	 * `onlyMissing` 是套模板专用的口径（F4.1）：只补模板里没有的字段，
	 * 判断发生在回调内、读的是**此刻的 frontmatter**——模板已经跑过 Templater 命令的话，
	 * 这里看到的就是 `status: active` 这种真实值，而不是还没执行的 `<% … %>`。
	 */
	async patchFrontmatter(
		path: string,
		patch: Record<string, unknown>,
		options: { onlyMissing?: boolean } = {},
	): Promise<void> {
		const file = this.resolveFile(path);
		if (file === null) return;
		await this.app.fileManager.processFrontMatter(
			file,
			(frontmatter: Record<string, unknown>) => {
				const effective =
					options.onlyMissing === true ? missingOnly(patch, frontmatter) : patch;
				for (const [key, value] of Object.entries(effective)) {
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
	 * - 快速项目：`folderPath = <扫描目录>/<快速项目标记>`（见 `quickProjectFolder`）→
	 *   文档落在共用的「快速项目」文件夹里，没有就现建（F3.1 的快速项目分区）。
	 *
	 * 先建正文、再用 processFrontMatter 写字段：两步走是刻意的——不手搓 YAML 序列化，
	 * 交给 Obsidian 自己的 frontmatter 写入器，中文、数组、日期的引号/转义规则由宿主保证。
	 *
	 * 模板口径（用户口径 2026-09-20，参数见 `settings.newProjectTemplate`）：
	 * - 没给模板 / 模板文件不存在 → 与既有行为一致（正文一行标题，字段全部来自 patch）；
	 * - 给了模板 → **正文整篇用模板的**（不追加标题，模板里有什么就是什么），
	 *   模板里缺的 frontmatter 字段才补 patch 里的值。
	 *   顺序是「先建（含命令）→ 让 Templater 执行 → 再补字段」：这样补字段时看到的是
	 *   模板命令跑完的真实值，`tp.system.suggester` 问出来的 status 不会被弹窗默认值盖掉。
	 *
	 * @param extraFolders 额外要建的目录（带文件夹形态下的「资料」子文件夹等）
	 * @param templatePath 模板笔记路径（vault 相对路径；空串/未给 = 不用模板）
	 * @returns 新建笔记的路径
	 */
	async createProject(input: {
		folderPath: string;
		title: string;
		patch: Record<string, unknown>;
		extraFolders?: string[];
		templatePath?: string;
	}): Promise<string> {
		const folder = normalizePath(input.folderPath.trim());
		await this.ensureFolder(folder);
		for (const extra of input.extraFolders ?? []) {
			await this.ensureFolder(extra);
		}

		const name = sanitizeNoteName(input.title);
		const path = this.uniquePath(folder, name);
		const template = this.resolveTemplate(input.templatePath);
		if (template === null) {
			await this.app.vault.create(path, `# ${input.title.trim()}\n`);
			await this.patchFrontmatter(path, input.patch);
			return path;
		}

		/*
		 * 两步模板替换，顺序不能换：
		 * 1. 先把核心「模板」插件的 `{{date:…}}` 这类占位符换掉（纯文本替换，谁也代替不了它）；
		 * 2. 再让 Templater 执行 `<% … %>`（`tp.file.title`、suggester 这些靠它）。
		 */
		const raw = await this.app.vault.read(template);
		const body = applyCoreTemplateSyntax(raw, {
			title: name,
			format: (format) => moment().format(format),
		});
		await this.app.vault.create(path, body);
		await this.runTemplateCommands(path);
		// 模板已给的值（含命令执行结果）一律不动，只补它还缺的
		await this.patchFrontmatter(path, input.patch, { onlyMissing: true });
		return path;
	}

	/**
	 * 模板文件（路径为空 / 找不到 / 不是文件都返回 null，调用方退回既有行为）。
	 *
	 * 路径来自用户从 Obsidian 复制粘贴，形态不止一种（绝对路径 / 缺扩展名 / wikilink），
	 * 所以先清洗成候选列表再逐个查（见 `templatePathCandidates`）。
	 *
	 * 仍然找不到时报错，不静默当作「没配模板」：那会让人以为模板生效了、实际什么都没套上。
	 */
	private resolveTemplate(path: string | undefined): TFile | null {
		const raw = (path ?? "").trim();
		if (raw.length === 0) return null;
		for (const candidate of templatePathCandidates(raw, vaultBasePath(this.app))) {
			const file = this.resolveFile(candidate);
			if (file !== null) return file;
		}
		new Notice(`找不到模板笔记：${raw}（已按无模板创建；该填 vault 相对路径，扩展名可省略）`);
		return null;
	}

	/**
	 * 把新笔记里的模板命令交给 Templater 执行（用户模板一般就是 Templater 模板：
	 * `tp.file.title`、`tp.system.suggester` 这类只有它跑过才有意义）。
	 *
	 * 刻意做成 best-effort：
	 * - Templater 是**可选依赖**，没装 / 没启用 / 那个版本没有这个方法 → 什么都不做，
	 *   命令原样留在笔记里（用户随时可以自己执行一次 Templater 命令，数据不会丢）；
	 * - 不 import、不声明依赖：官方没有它的类型包，插件也不该硬依赖另一款社区插件，
	 *   所以这里按「有就调、没有就算了」的方式去拿实例。
	 */
	private async runTemplateCommands(path: string): Promise<void> {
		const file = this.resolveFile(path);
		if (file === null) return;
		const templater = (this.app as AppWithPlugins).plugins?.plugins?.["templater-obsidian"]
			?.templater;
		if (templater === undefined || typeof templater.overwrite_file_commands !== "function") {
			return;
		}
		try {
			await templater.overwrite_file_commands(file);
		} catch {
			/*
			 * 模板里的用户脚本抛错（最常见的是 `tp.system.suggester` 被 Esc 取消）。
			 * 笔记已经建好了，不能因为模板出错就把整条创建算失败——提示一句，
			 * 命令原样留在笔记里，用户想跑随时可以再执行一次。
			 */
			new Notice("模板命令未全部执行，笔记已按模板原文创建；可稍后执行一次模板命令重跑");
		}
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

/**
 * 只挑出「模板里还没有」的字段（用户口径 2026-09-20：模板缺什么补什么）。
 *
 * 「还没有」= 键不存在、值为空（null / 空串），或值还是一段没执行过的模板命令。
 * 最后一条是给「没装 Templater」兜底的：`status: <% tp.system.suggester(...) %>` 这类
 * 值留着当真的话，项目状态就是一串命令而不是 `inbox`，索引层还会报「非法状态」——
 * 那还不如让弹窗里选的值生效。
 *
 * 值为 null 的 patch 键直接跳过：那是 patchFrontmatter 的「删除字段」语义，
 * 而在新建的笔记里没有任何东西需要删，更不该去删模板给的字段。
 */
export function missingOnly(
	patch: Record<string, unknown>,
	frontmatter: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === null || value === undefined) continue;
		const existing = frontmatter[key];
		if (isEmptyValue(existing) || isTemplateCommand(existing)) out[key] = value;
	}
	return out;
}

/** 值是否还是没跑过的模板命令（`<% … %>`） */
function isTemplateCommand(value: unknown): boolean {
	return typeof value === "string" && value.includes("<%");
}

/**
 * `app.plugins` 不在公开类型里，而我们要拿的 Templater 实例只在运行时存在。
 * 只声明用到的那一层，避免把整个内部结构写进类型。
 */
type AppWithPlugins = App & {
	plugins?: {
		plugins?: Record<string, { templater?: { overwrite_file_commands?(file: TFile): Promise<void> } } | undefined>;
	};
};

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
