import obsidianmd from "eslint-plugin-obsidianmd";

/**
 * 官方 obsidianmd ESLint 预设（agent.md：零 error 方可合并）。
 *
 * 兼容性说明（2026-09-18）：eslint-plugin-obsidianmd 0.1.9 的 configs.recommended
 * 在配置对象里使用了 `extends` 键（依赖旧版 ESLint 的容忍行为），当前 ESLint 9.39
 * 会直接报错。此处用 inlineExtends() 把 `extends` 声明式展开为扁平配置，
 * 官方规则集本身不做任何增删。
 */
function inlineExtends(items) {
	const out = [];
	for (const item of items) {
		if (item && typeof item === "object" && "extends" in item) {
			const { extends: ext, ...rest } = item;
			for (const e of ext) {
				if (Array.isArray(e)) {
					out.push(...inlineExtends(e));
				} else {
					out.push(e);
				}
			}
			if (Object.keys(rest).length > 0) {
				out.push(rest);
			}
		} else {
			out.push(item);
		}
	}
	return out;
}

export default [
	{
		ignores: ["node_modules/**", "main.js", "coverage/**", "esbuild.config.mjs"],
	},
	...inlineExtends([...obsidianmd.configs.recommended]),
	{
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	/*
	 * 测试里放行 Node 内置模块。
	 *
	 * 预设的 `import/no-nodejs-modules` 管的是**会被打进 main.js 的插件代码**——
	 * Obsidian 的运行时不给插件 Node 模块，所以那条规则对 src 必须保留。
	 * 而 tests/ 只在开发机上跑（vitest，Node 环境）、从不进产物：字典覆盖用例要读
	 * 源码做扫描，只能走 node:fs。这里只对 tests 放行，src 的策略一字不改。
	 */
	{
		files: ["tests/**/*.ts"],
		rules: { "import/no-nodejs-modules": "off" },
	},
];
