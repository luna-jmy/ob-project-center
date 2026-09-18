import { ProjectItem, ProjectMasterSettings } from "../types";
import { buildProjectItem, DataIssue, ProjectFileInfo } from "./project-item";

/**
 * 项目索引（SPEC §3.1）—— 依赖注入的纯数据管道，零 Obsidian 依赖。
 *
 * - Obsidian 侧由 main.ts 装配：files ← vault.getMarkdownFiles()，
 *   frontmatter ← metadataCache.getFileCache(file)?.frontmatter；
 *   metadataCache 的 changed/deleted 事件在 main.ts 中 registerEvent 后转调 update/remove。
 * - 索引不持有 DOM、不做兜底日期计算（±7 天策略属甘特渲染层）。
 */

/** frontmatter 原始读取器：无缓存/无 frontmatter 返回 null */
export type FrontmatterReader = (path: string) => Record<string, unknown> | null;

export class ProjectIndex {
	private readonly items = new Map<string, ProjectItem>();
	private readonly issues = new Map<string, DataIssue[]>();

	constructor(
		private readonly files: ProjectFileInfo[],
		private readonly readFrontmatter: FrontmatterReader,
		private readonly settings: ProjectMasterSettings,
	) {}

	/** 全量重建（幂等：清空后重扫；范围外文件直接跳过） */
	rebuild(): void {
		this.items.clear();
		this.issues.clear();
		for (const file of this.files) {
			if (!this.isInScope(file)) {
				continue;
			}
			this.indexFile(file);
		}
	}

	/**
	 * 增量更新（metadataCache changed 事件入口）。
	 * @returns 是否在本索引范围内处理（范围外返回 false，调用方可忽略）
	 */
	update(path: string): boolean {
		const file = this.toFileInfo(path);
		if (!this.isInScope(file)) {
			return false;
		}
		this.items.delete(path);
		this.issues.delete(path);
		this.indexFile(file);
		return true;
	}

	/** 增量删除（deleted / rename 旧路径事件入口） */
	remove(path: string): void {
		this.items.delete(path);
		this.issues.delete(path);
	}

	getAll(): ProjectItem[] {
		return [...this.items.values()];
	}

	/** path → 数据问题清单（UI 修复提示数据源） */
	getIssues(): Record<string, DataIssue[]> {
		return Object.fromEntries(this.issues);
	}

	private indexFile(file: ProjectFileInfo): void {
		const frontmatter = this.readFrontmatter(file.path);
		if (frontmatter === null) {
			return;
		}
		const { item, issues } = buildProjectItem(frontmatter, file, this.settings);
		if (item !== null) {
			this.items.set(file.path, item);
			if (issues.length > 0) {
				this.issues.set(file.path, issues);
			}
		}
	}

	private isInScope(file: ProjectFileInfo): boolean {
		const inScanFolder = this.settings.scanFolders.some(
			(folder) => file.path === folder || file.path.startsWith(`${folder}/`),
		);
		if (!inScanFolder) {
			return false;
		}
		const inExcluded = this.settings.excludedFolders.some(
			(folder) => file.path === folder || file.path.startsWith(`${folder}/`),
		);
		return !inExcluded;
	}

	private toFileInfo(path: string): ProjectFileInfo {
		const segments = path.split("/");
		const name = segments[segments.length - 1].replace(/\.md$/, "");
		const folder = segments.slice(0, -1).join("/");
		return { path, name, folder };
	}
}
