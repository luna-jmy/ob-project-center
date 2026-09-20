/**
 * vitest 运行时替身：`obsidian` npm 包只提供 `obsidian.d.ts`（package.json 无 main），
 * 无法被 vite 解析。vitest.config.ts 用 alias 把 `obsidian` 指向本文件。
 *
 * 注意：tsc 走的是真实的 `node_modules/obsidian/obsidian.d.ts`（本 alias 只作用于产物打包），
 * 所以生产代码的类型检查仍然是宿主真实类型——这里只需要**运行时行为**够用。
 *
 * 只实现被测模块真正会调用的部分；新增被测模块时按需补，不预先堆一整份 API。
 */

/** 文件系统抽象的最小替身（仅用于 `instanceof` 判断） */
export class TAbstractFile {
	path = "";
	name = "";
	parent: unknown = null;
}

export class TFile extends TAbstractFile {
	extension = "md";
	basename = "";
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

/**
 * 与宿主实现等价的路径规范化：去首尾斜杠、折叠重复斜杠、去 `./`。
 * 测试里只关心「不会破坏正常相对路径」这一条。
 */
export function normalizePath(path: string): string {
	let result = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
	result = result.replace(/^\.\//, "").replace(/\/\.\//g, "/");
	result = result.replace(/^\/+/, "").replace(/\/+$/, "");
	return result === "" ? "/" : result;
}

export const Platform = {
	isDesktop: true,
	isMobile: false,
	isMobileApp: false,
	isDesktopApp: true,
	isIosApp: false,
	isAndroidApp: false,
	isMacOS: true,
	isWin: false,
	isLinux: false,
};

/** 观测用的 Notice 替身（断言「是否弹了提示」） */
export class Notice {
	static messages: string[] = [];
	constructor(message: string) {
		Notice.messages.push(message);
	}
}
