# Project Master

把项目笔记变成可交互的项目看板：甘特图、筛选、分组面板。
数据全部来自笔记的 frontmatter——不引入数据库，也不改动你现有的项目笔记结构。

## 安装

1. 到 [Releases](https://github.com/luna-jmy/ob-project-center/releases) 下载最新版本；
2. 手动安装（zip）：解压后把 `main.js`、`manifest.json`、`styles.css` 三个文件放进
   `<你的 vault>/.obsidian/plugins/project-master/`（目录不存在就自己建，文件夹名必须叫 `project-master`）；
3. 回到 Obsidian：「设置 → 第三方插件」刷新一下，然后启用 **Project Master**。

要求 Obsidian **1.8.7** 或更高版本。

## 打开

点左侧边栏的 ribbon 图标，或命令面板（`Ctrl/Cmd + P`）→ `Open project dashboard`。

会在新标签页里打开：左边是分组面板，右边是「甘特图 / Mermaid」两个 Tab。
工具栏上另有两个开关值得知道：**收起侧栏**（让甘特占满）与**面板模式**（让面板占满整页，当纯看板用）。

## 前提：笔记得能被认出来

插件只看**扫描目录**里的笔记，并且笔记要满足任一条：

- frontmatter 里有 `type: project`，或
- `tags` 里有 `project`

最小可用示例：

```yaml
---
type: project
status: active          # 中英文都认：执行中 / active
start_date: 2026-01-01
due_date: 2026-03-31
---
```

- 扫描目录默认是 `100 Projects`，支持填多个，改「设置 → 全局参数」；
- **字段名都能换**：改「设置 → 字段映射」那张表就行，不必改代码（换模板只改这一处）；
- 起止日期缺失时，按全局参数里的兜底策略处理（按天数推导 / 不上图并在界面上提示）。

## 三个先知道就不会觉得奇怪的行为

- **长期项目**（`long-term: true`）不上甘特图，也豁免所有日期筛选——它只在左侧面板出现，
  卡片右上角的「编辑」按钮是修改它的入口。
- **已取消**（`status: cancelled`）的项目默认同样不上甘特图（这条可在设置里关掉）。
- 有项目没上甘特图时，界面顶部会写明**原因和数量**（已取消 / 缺日期 / 长期项目），
  不用自己猜少了哪一条。

## 已知限制

- Mermaid 导出不支持逐条任务单独配色（这是 mermaid 自身的限制），界面里已注明；
- 甘特条的拖拽改期在移动端禁用（与触屏滚动手势冲突）。

## 隐私

纯本地：**不发起任何网络请求**，无遥测、无账号、无付费、无外部服务调用，
所有读写只发生在你自己的 vault 里。

## 许可

MIT。改动记录见 [CHANGELOG.md](./CHANGELOG.md)。
