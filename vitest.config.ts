import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * vitest 配置（SPEC §8）。
 *
 * 唯一的特殊处理：把 `obsidian` 指向 tests/obsidian-stub.ts。
 * 官方 `obsidian` npm 包只有 obsidian.d.ts、没有 main 字段，vite 无法解析入口，
 * 任何被测模块只要 import 到它就会直接解析失败。alias 只作用于**运行时打包**，
 * tsc 仍走宿主真实类型声明，因此不会掩盖类型问题。
 */
export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL("./tests/obsidian-stub.ts", import.meta.url)),
		},
	},
});
