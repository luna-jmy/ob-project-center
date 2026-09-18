# SPEC — Project Master 插件设计规格（v2 重写版）

> 状态：**已确认，进入构建**（2026-09-18）
> 约束前提：实现规范以 **`obsidian-plugin-development` 技能**（SKILL.md + references/compatibility.md + references/release.md，政策核验日期 2026-09-18）为权威；本仓库 `agent.md` 只保留项目专属增量（冲突防护一票否决）。技能与官方政策冲突时以官方为准。
> 流程：Superpowers 工作流 · 阶段 1（头脑风暴）产出 · **基于现有体系真实参考重写**
> 参考：`ref/TPL-Project.md`（项目模板）、`ref/项目中心（升级）.md`（dashboard 笔记）、`ref/projectGantt.js`、`ref/projectOverview.js`（现有 dataviewjs dashboard）

---

## 1. 项目概述

Project Master 是一个 Obsidian 项目管理 dashboard 插件，**替代并升级**现有「dataviewjs 项目中心笔记」方案：以独立工作区视图承载可交互甘特图（点击跳转笔记、UI 编辑项目关键信息）、筛选排序、项目分组面板。数据源为**现有 TPL-Project 模板的 frontmatter 体系，零迁移成本**——现有项目笔记不做任何修改即可被插件识别。

### 1.1 核心痛点（插件的立身之本，优先级最高）

现有 dataviewjs dashboard 两大不满意，**本插件 v1 的核心验收目标**：

1. **内部联动性差**：甘特图是 mermaid 静态渲染的代码块，**点击任务条无法跳转笔记**，与其他面板也无联动。→ 对策：交互式甘特库 + 全视图联动体系（§4 F1、F3.4）：点击跳转、右键编辑、分组↔甘特双向定位高亮、hover 预览，联动是一等公民而非附属功能。
2. **筛选限制太多**：现有筛选绑死在 dashboard 笔记 frontmatter 传参（`filter: include/exclude`、`status: hide`、`start_date/due_date` 当筛选区间用），一次只能生效一组、选项互斥受限（status 三档、area 只能相对"当前笔记的领域"做 include/exclude，**无法直接选定某几个领域**）。→ 对策：筛选全部收进视图 UI，多选、自由组合、即时生效、一键清除（§4 F2）。

### 1.2 与现有体系的关系

| 现有资产 | 处置策略 |
|---|---|
| TPL-Project.md 模板 | **原样兼容**，插件完全按其 frontmatter 字段设计（§2） |
| dataviewjs dashboard（项目中心笔记） | 功能被插件视图取代；过渡期两者可并存，最终可退役该笔记 |
| projectGantt.js / projectOverview.js | 其**业务规则全部继承**进插件（§4 明确列出），非重新设计 |
| 自研插件 gantt-builder（task→mermaid gantt） | v1 共存不冲突（插件不碰其正文标记块）；F1.7 Mermaid 导出与其落点格式对齐；v2 评估将其任务级数据整合进 Project Master（§11） |

### 已确认决策

| # | 决策点 | 结论 |
|---|--------|------|
| D1 | 任务数据源 | 现有 TPL-Project frontmatter 体系（`type: project` 识别），字段名/枚举/别名全部沿用 |
| D2 | MVP 范围 | 项目级甘特图核心（跳转+UI编辑）+ 筛选排序 + 分组面板 |
| D3 | UI 载体 | 独立工作区视图（ItemView），不依赖 dashboard 笔记 |
| D4 | 甘特渲染 | 插件交互式重建（候选 frappe-gantt + 强制隔离适配层），**弃用静态 mermaid 渲染**，但保留 Mermaid 导出能力（F1.7） |
| D5 | gantt-builder 整合 | v2 目标：读取 `%% gantt-builder-data-start %%` 数据块，实现任务级甘特下钻（v1 只做项目级） |

---

## 2. 数据模型（继承 TPL-Project，不做发明）

### 2.1 项目识别规则

- **主规则**：frontmatter `type: project` 即项目笔记（与 projectGantt.js/projectOverview.js 一致）；
- **范围限定（可配置）**：默认只扫描 `100 Projects` 目录（现有脚本行为），目录可改，支持多目录；
- 排除 dashboard 笔记自身及其所在根目录层（现有脚本排除 `"100 Projects"` 根层文件的逻辑保留）。

### 2.2 Frontmatter 字段（原文沿用，字段名全部可在设置中重映射）

| 字段 | 类型/枚举 | 用途 | 备注 |
|------|-----------|------|------|
| `type` | `"project"` | 识别标志 | |
| `status` | `inbox / draft / active / on-hold / completed / cancelled / archived` | 状态 | **必须兼容中文别名**：`未开始/待启动、起草/构思中、执行中、暂停、完成、取消、归档`（历史数据可能为中文，见 §2.3） |
| `priority` | `"1"~"5"` | 优先级 | 模板存字符串；展示映射 🔴🟠🟡🔵⚪ |
| `start_date` / `due_date` | `YYYY-MM-DD` | 甘特起止 | **`end_date` 作为 due_date 的 fallback**（现有脚本兼容行为） |
| `completion_date` | 日期 | 实际完成日 | v1 展示，v2 用于统计 |
| `progress` | 0-100 | 进度条 | |
| `area` | string 或 string[] | 领域（核心筛选维度） | 支持数组（现有脚本已处理） |
| `objective` | string | 目标 | projectGantt.js 用它做甘特 section 分组 |
| `context` | string | 情境 | v1 透传展示 |
| `tags` | 含 `project` | 补充识别 | |
| `project-leader` / `project-members` | string/list | 人员 | 卡片展示 |
| `long-term` | boolean | 长期项目 | `true` 时**豁免日期筛选**（现有规则） |
| `main-project` | boolean | 主项目标记 | 多项目文件夹代表逻辑（§4.3） |
| `project-id` | `YYYYMM` | 项目编号 | v1 透传展示 |
| `created` | 日期 | 创建时间 | |

### 2.3 数据规范化层（normalize）

索引阶段统一清洗，**只读不改写用户数据**：

- status 中文别名 → 规范枚举（映射表见 projectOverview.js 的 completedStatuses / statusMap，原样抽取为常量）；
- 日期字段容错解析（字符串/Luxon DateTime/Dataview 格式）→ 统一 `YYYY-MM-DD`；非法日期标记 `invalid`，UI 提示修复，不静默纠正；
- `area`/`project-members` 单值→数组统一；
- 缺日期兜底规则（继承 projectGantt.js）：无 start → end 前 7 天；无 end → start 后 7 天；**兜底仅在甘特渲染时生效，写回编辑时要求用户补全真实日期**。

---

## 3. 架构设计

```
main.ts（薄装配）
src/
├── views/dashboard-view.ts     # ItemView：布局组装与生命周期
├── services/
│   ├── project-index.ts        # metadataCache 增量索引 + §2.3 规范化
│   ├── project-service.ts      # frontmatter 读写（processFrontMatter）
│   ├── filter-service.ts       # 筛选/排序管道（纯函数）
│   └── grouping-service.ts     # 分组逻辑（文件夹/main-project/快速项目/area）
├── gantt/gantt-adapter.ts      # 甘特库封装 + 样式隔离层
├── panels/group-panel.ts       # 分组面板
├── modals/project-editor-modal.ts  # 项目编辑 Modal
├── settings.ts
└── types.ts                    # ProjectItem、设置接口（带版本号）
```

### 3.1 索引与数据流

- 通过 `metadataCache` 读取（禁全量遍历），`registerEvent` 监听 `changed/deleted/resolved` 增量更新；初始 UI 在 `workspace.onLayoutReady()` 后构建；
- 单向数据流：frontmatter → 索引/规范化 → filter/grouping 管道 → 渲染；UI 编辑 → `FileManager.processFrontMatter` 写回 → 事件驱动刷新；
- `project-index`、`filter-service`、`grouping-service`、规范化层全部为**纯函数/纯数据**，TDD 主战场，零 DOM 依赖。

---

## 4. 功能需求（MVP）——业务规则逐条继承现有脚本

### F1 甘特图核心（对应 projectGantt.js）
- F1.1 渲染项目级甘特：任务条=项目笔记，**section 按 `objective` 分组**（多组才显示 section 头，与现有脚本一致）；
- F1.2 日期逻辑：`due_date || end_date` 为止点；时间轴默认按 `dashboard 笔记 start_date/due_date` 的方式可由视图内日期筛选器控制（不再依赖笔记 frontmatter 传参）；
- F1.3 **点击任务条 → 打开项目笔记**（新 leaf，不抢占当前）；右键打开编辑 Modal；
- F1.4 **拖拽调整起止日期 → 写回 frontmatter**（拖拽结束才落盘，Esc 回滚；写回目标字段尊重 `end_date` fallback 设置）；
- F1.5 状态着色：`completed` → done 样式、`active` → active 样式（对应现有 mermaid 的 done/active 标记）；
- F1.6 `cancelled` 项目默认不出现在甘特图（现有规则）；
- F1.7 **Mermaid 导出（与 mermaid 生态双向兼容）**：
  - 「复制 Mermaid」按钮/命令：把当前视图状态（**经筛选、分组、排序后的**）导出为完整 mermaid gantt 代码块，可直接粘贴进任意笔记由 Obsidian 渲染；
  - 导出格式**与 projectGantt.js 的输出约定保持一致**：`dateFormat YYYY-MM-DD`、`axisFormat %y-%m`、按 `objective` 分 section（多组才输出 section 头）、`completed→done,` / `active→active,` 状态标记、任务名清洗规则（去除非中英文数字字符）——保证新旧两套方案产出的 mermaid 风格统一、数据互通；
  - 「导出到笔记」增强项：支持写入指定笔记的 `%% gantt-builder:start %%` 标记块之间（复用现有模板占位，与 gantt-builder 同一落点，v2 整合时的天然衔接点）；写入必须原子完成、基于最新内容最小改动，标记块缺失/损坏时报告而不损坏笔记；
  - 导出器实现为**纯函数**（视图状态 → mermaid 字符串），全量单测覆盖（含中文任务名、缺失日期兜底值、单 section 不出头等边界）；
  - 反向兼容说明：插件渲染**不依赖** mermaid（mermaid 只是导出目标），用户手工修改笔记中的 mermaid 块不会回流影响插件数据——单一事实源仍是 frontmatter。

### F2 筛选 + 排序（继承现有语义，**全面放开限制**）

> 设计原则：筛选状态完全收进视图 UI，**不再依赖 dashboard 笔记 frontmatter 传参**；所有条件自由组合、实时生效、一键清除。现有脚本的匹配语义作为行为基准被继承，但交互上限大幅提高。

- F2.1 **status 多选**：7 种状态（含中文别名归一）以可勾选 chips 呈现，任意组合；提供快捷档「隐藏已完成」（默认）/「仅已完成」/「全部」作为一键预设；
- F2.2 **area 直接多选具体值**：候选列表从项目集合动态收集（现有行为），点选任意多个领域做 OR 过滤；保留「仅当前领域 / 排除当前领域」快捷键（对应现有 include/exclude，仅在带 area 的上下文入口可用）；
- F2.3 **搜索**：按项目名模糊匹配，输入即筛（300ms 防抖，优于现有 Enter/失焦触发）；
- F2.4 **日期范围**：预设（全部/本周/本月/本季度/本年）+ 自定义起止区间，直接在 UI 设置；区间匹配规则**原样继承**：完整区间取交集、仅 start 取「≥」、仅 end 取「≤」、`long-term: true` 豁免；
- F2.5 筛选条件组合状态实时显示计数（如「12/30 个项目」），空结果给出可操作的空态（如「清除筛选」按钮），不再只是「📭 没有符合筛选条件的项目」；
- F2.6 排序：due_date 升序（甘特默认）/ 项目名 / priority；分组面板内按现有规则（主项目 due_date 优先，无日期退化为文件夹名排序）；
- F2.7 筛选联动：筛选同时作用于甘特图与分组面板（一套管道两处渲染）。

### F3 分组面板（对应 projectOverview.js 的卡片分区逻辑）
- F3.1 **快速项目分区**：`100 Projects` 根层项目 + 路径含「快速项目」的文件夹（分区名按路径层级展示，`/`→` > `）；
- F3.2 **正常项目分区**：按文件夹分组卡片；**多项目文件夹取 `main-project: true` 作代表**；多个项目但无一标记 main-project → 显示「⚠️ N 个项目文档」警告徽章（现有规则）；
- F3.3 卡片内容：项目名链接、priority/status 徽章（emoji 映射沿用）、progress 进度条、日期区间、笔记数、组内笔记列表（默认前 N 条，N 可配置，现有 maxNotes=5/20 行为）；
- F3.4 面板与甘特图联动：点击分组/项目 → 甘特图滚动定位并高亮对应任务条。

### F4 UI 编辑
- F4.1 「新建项目」→ Modal：Templater 模板联动可选（优先直接创建笔记并写 frontmatter，模板套用作为增强项）；
- F4.2 编辑 Modal 字段：status（suggester 式 7 选项，**沿用模板中文标签+英文值**）、priority（1-5）、start_date/due_date、progress、area、objective、project-leader/members、long-term、main-project；
- F4.3 全部写回经 `FileManager.processFrontMatter`，禁止自读自写；
- F4.4 删除项目 = 仅清除 `type` 字段使其脱离管理（保留笔记），二次确认。

### F5 Dashboard 视图
- ItemView（view type 带插件 id 前缀）+ ribbon + 命令；布局：工具栏（新建/缩放/筛选/排序）+ 左分组面板（可折叠）+ 右甘特区。

---

## 5. 参数分离设计（settings）

> 设计原则：**插件逻辑零硬编码业务常量**。所有来自 TPL-Project 模板与现有脚本的可变项（文件夹位置、字段名、枚举别名、路径标记）全部下沉为参数；参数分四组管理，未来模板调整字段或换模板时只改设置、不改代码。

### 5.1 全局参数（vault 结构与行为）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 项目扫描目录 | `["100 Projects"]` | **多目录支持**（现有脚本硬编码单目录，升级） |
| 快速项目路径标记 | `快速项目` | 路径命中即归快速分区（现有硬编码改可配） |
| 排除文件夹 | `.obsidian, templates` | |
| 中文别名兼容 | 开 | 关闭后仅识别英文枚举（§2.3） |
| 日期兜底策略 | ±7 天 | 可改为「标记无效」 |

### 5.2 字段映射参数（模板自定义字段分离）⭐

TPL-Project 的每个业务字段名都做成**可重映射参数**，插件内部一律通过逻辑字段名（`ProjectItem` 接口）访问，不直接引用物理字段名：

| 逻辑字段 | 默认物理字段（= 模板现状） |
|----------|---------------------------|
| `type` | `type` |
| `status` | `status` |
| `priority` | `priority` |
| `startDate` | `start_date` |
| `dueDate` | `due_date` |
| `endDateFallback` | `end_date` |
| `completionDate` | `completion_date` |
| `progress` | `progress` |
| `area` | `area` |
| `objective` | `objective` |
| `context` | `context` |
| `projectLeader` / `projectMembers` | `project-leader` / `project-members` |
| `longTerm` / `mainProject` | `long-term` / `main-project` |
| `projectId` | `project-id` |
| `identifyTag` | `project`（tags 内识别标签） |

- 读取与写回（含 F1.7 mermaid 导出、F4 编辑 Modal）全部经映射层；换模板 = 改一张映射表；
- 映射表支持**导出/导入 JSON**（预设机制），便于多 vault 或换模板复用。

### 5.3 枚举与展示参数

- status 枚举值 + 中文别名映射表（§2.3）可编辑；
- priority 值与 emoji/文案映射（🔴🟠🟡🔵⚪）可编辑；
- status 7 档 suggester 顺序（对齐模板交互）可编辑。

### 5.4 视图偏好

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 默认排序 | due_date 升序 | |
| 默认缩放 | 月 | |
| 默认分组依据 | 文件夹 | 文件夹 / objective / area |
| 每项目笔记预览数 | 5 | 现有 maxNotes 行为 |

（F2.7 的筛选组合状态按 v1 决议不做持久化。）

### 5.5 参数实现约束

- 设置接口带 `version` + 迁移函数（agent.md §2.4），升级不丢配置；
- 全部参数经 `Plugin.loadData()/saveData()` 持久化；
- 设置页用 Obsidian 原生 API 构建（`setHeading()` 分组、无手搓 heading）。

---

## 6. 冲突防护设计（一票否决，对齐技能 compatibility.md + agent.md §2）

1. **frappe-gantt 隔离容器** `pm-` 前缀类作用域；库样式变量在容器内 override 为 Obsidian CSS 变量（现有 dataviewjs 大量内联 style，插件版**全面禁止**，全部迁入 styles.css）；**构建产物也要复查**——库自带的 CSS 不能引入全局选择器/z-index 污染；
2. **cssclasses `fullwidth`/`matrix` 与现有 CSS 片段**：现有 dashboard 依赖用户 CSS 片段美化卡片；插件自带样式后，须审计与这些片段的选择器无冲突——插件类名一律 `pm-` 前缀，不复用 `project-card` 等现有裸类名；
3. **gantt-builder 共存**：其标记块 `%% gantt-builder:start %%` 等在项目笔记正文中，Project Master 只读 frontmatter，不触碰正文标记块，v1 零干扰；
4. 生命周期全部按技能实现约束：事件走 `registerEvent/registerDomEvent/registerInterval`；甘特库 destroy 收口；**`onunload` 不 detach leaves**（避免破坏布局恢复）；视图经 `registerView` 工厂创建、不保存全局实例；`onload` 只做轻量注册，索引在 `onLayoutReady` 后分批、可中止；
5. 命令用 `callback`/`checkCallback`（检查回调无副作用）；不注册默认快捷键；弹窗（popout window）场景 DOM 用元素所属 `ownerDocument`；
6. 验收：按技能「按功能选择测试矩阵」执行——干净 vault、启用/禁用三轮、明暗主题、Templater/Dataview/gantt-builder/Kanban 共存（含反向加载顺序）、双插件同写一篇测试笔记、暗色主题目视检查。

---

## 7. 兼容性与移动端

- `minAppVersion` 取当前最新稳定版（无法确定时不虚标旧版本）；
- 移动端：甘特查看/跳转可用，拖拽降级 Modal 编辑；目录路径硬编码 `'100 Projects'` 的假设全部参数化（移动端同样生效）；
- `isDesktopOnly` 以**依赖图与构建产物**实测为准：frappe-gantt 为纯浏览器库，理论上 `false` 可行，但必须按技能要求验证依赖图后才允许声明；
- 弹出窗口（popout）中打开 dashboard 视图时功能完整（DOM 归属正确 ownerDocument）。

---

## 8. 测试策略（TDD 强制）

- Vitest + `vi.mock('obsidian')`；
- 纯逻辑层全覆盖：**规范化层（中文 status 别名、日期容错、area 数组化）**、**筛选管道（status 多选、area include/exclude、日期区间交集/单边/long-term 豁免——直接从 projectOverview.js 的规则表转写测试用例）**、**分组逻辑（main-project 代表、快速项目路径命中、多项目无主警告）**、设置迁移；
- gantt-adapter 的 TaskItem↔frontmatter 双向转换、**Mermaid 导出器（视图状态→mermaid 字符串，逐条对齐 projectGantt.js 输出约定）**做纯函数单测；
- **易破坏数据逻辑的边界测试**（技能要求）：processFrontMatter 回调基于最新内容最小改动、设置迁移可重复执行且失败保留原数据、「导出到笔记」对标记块缺失/损坏的容错；
- 实机验证按技能测试矩阵记录（插件/主题/Obsidian 版本、步骤、预期、结果）；无 Obsidian 实机的项明确标注「未测试」，不虚报通过；
- 发布前：`eslint-plugin-obsidianmd` 零 error（按锁定版本配置，不机械复制旧配置）+ release.md 三态检查报告。

---

## 9. 上架对齐

## 9. 上架对齐（详细检查项以技能 release.md 为准）

- 插件 id 候选：`project-master`（仅小写字母和连字符；禁含 obsidian、禁以 plugin 结尾；开发安装文件夹名 = id；上架前在社区目录查重）；
- **name 规则（2026-09-18 核验）**：简短唯一、Basic Latin、不含 Plugin/Obsidian、不占用核心功能名（候选 "Project Master" 需上架前再核）；
- description ≤250 字符、英文句号结尾、无 emoji、动作句开头；
- README 披露：纯本地、无网络/付费/账号/遥测；MIT LICENSE；`main.js` 只进 Release；
- **version**：`x.y.z`；GitHub release tag 与之完全一致（**不加 `v` 前缀**）；manifest/资产/package 版本一致；`versions.json` 为可选维护项，若维护须正确记录映射；
- **提交流程（现行版）**：GitHub release → 登录 community.obsidian.md → 关联 GitHub → 仪表盘提交 → 解决自动审核反馈；**不沿用**编辑 community-plugins.json 提 PR 的旧教程；有审核错误时 Publish 也不可安装，需增版本重新发布；
- 构建产物检查：bundle 外置宿主模块（`obsidian` 等），附件用发行版实装到测试 vault 验证加载/卸载/设置保留；只有 Luna 明确要求发布时才创建远端 release 或提交目录。

---

## 10. Out of Scope（v1 不做）

| 功能 | 归属 |
|------|------|
| **gantt-builder 整合**：读取 `%% gantt-builder-data-start %%` 任务数据块，项目条下钻任务级甘特 | v2（D5） |
| 任务级 CRUD（在 Project Master 内编辑 gantt-builder 数据块） | v2 |
| 笔记内容可视化（统计图等） | v2 |
| 项目间依赖连线（FS 箭头） | v2 |
| 移动端拖拽、筛选状态持久化 | 视反馈 |

---

## 11. 风险与开放问题

| 风险 | 应对 |
|------|------|
| frappe-gantt 审计不通过（全局污染） | fallback 自绘（D4 降级路径） |
| 历史数据 status 为中文、日期格式混杂 | §2.3 规范化层 + 专项测试用例 |
| 大量项目渲染卡顿 | 分组懒渲染，必要时日期窗口虚拟化 |
| 与 gantt-builder 未来整合时数据块格式耦合 | v1 不读正文；v2 整合前先冻结其数据块 schema |
| dashboard 笔记退役过渡期双轨混乱 | 插件视图与笔记可并存，README 给迁移指引 |

**待 Luna 确认后**：进入阶段 2（worktree）→ 阶段 3（实施计划）喵。
