/**
 * 打包发布产物（本地用，不进版本库）。
 *
 * 把 Obsidian 插件需要的三个文件打成 `dist/<插件 id>-<版本>.zip`，
 * 版本号直接读 manifest.json，避免手写文件名时版本号与 manifest 对不上。
 *
 * 为什么包一层脚本：Windows 有 `Compress-Archive`、macOS/Linux 有 `zip`，
 * 两边命令不一样——写在文档里迟早只改其中一处；脚本里按平台选工具，只留一份真相。
 * 产物目录 `dist/` 在 .gitignore 中：它是 Release 附件，不是源码。
 *
 * 用法：npm run build && npm run package
 * （build 产出 main.js，package 只负责打包）
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";

/** 插件运行需要的三个文件；顺序即 zip 内的顺序 */
const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];
const OUT_DIR = "dist";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { id, version } = manifest;
if (typeof id !== "string" || typeof version !== "string") {
	console.error("manifest.json 里读不到 id 或 version，无法命名产物");
	process.exit(1);
}

// 缺 main.js 通常意味着还没构建；直接说清楚，而不是打出一个不完整的包
const missing = PLUGIN_FILES.filter((file) => !existsSync(file));
if (missing.length > 0) {
	console.error(`缺少构建产物：${missing.join("、")}；请先运行 npm run build`);
	process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const zipPath = `${OUT_DIR}/${id}-${version}.zip`;

if (process.platform === "win32") {
	execFileSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			`Compress-Archive -Path ${PLUGIN_FILES.map((f) => `'${f}'`).join(",")}` +
				` -DestinationPath '${zipPath}' -Force`,
		],
		{ stdio: "inherit" },
	);
} else {
	// -j：只存文件名、不带目录层级，解压出来正好是三个文件
	execFileSync("zip", ["-j", "-q", zipPath, ...PLUGIN_FILES], { stdio: "inherit" });
}

console.log(`${zipPath}  ${statSync(zipPath).size} bytes`);
console.log(`包含：${PLUGIN_FILES.join("、")}`);
