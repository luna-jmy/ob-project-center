# Project Master

Obsidian 项目管理 dashboard 插件：可交互甘特图（点击跳转笔记、UI 编辑）、筛选排序、项目分组面板。数据源为项目笔记 frontmatter，零迁移兼容现有 TPL-Project 模板。

> 开发中（Milestone 0 骨架）。设计规格见 [SPEC.md](./SPEC.md)，开发约束见 [agent.md](./agent.md)。

## 纯本地声明

本插件**不发起任何网络请求**：无遥测、无账号、无付费、无外部服务调用。

## 开发

```bash
npm install        # 安装依赖
npm run dev        # watch 构建
npm run build      # 类型检查 + 生产构建
npm run test       # vitest 单测
npm run lint       # eslint (eslint-plugin-obsidianmd)
```
