# agent.md — 本仓库插件开发专属约束

> 本文件只保留**项目专属**约束与快速索引。通用规则（生命周期管理、样式隔离、文件写入 API、发布检查清单）以 **`obsidian-plugin-development` 技能**为唯一权威实现规范，开发时必须先加载该技能并遵循其 `SKILL.md`、`references/compatibility.md`、`references/release.md`；技能摘要与官方政策冲突时，以官方文档为准。
> 官方文档：<https://docs.obsidian.md/> · 技能政策核验日期：2026-09-18（发布前需重查）
> 背景教训：本仓库此前开发的插件因样式全局污染、DOM 越权修改、事件监听器泄漏引发插件冲突——技能 compatibility.md 的全部条款在本仓库按**一票否决**执行。

---

## 1. 技能覆盖范围（本文件不再重复的内容）

以下内容直接查技能，本文件**不再维护副本**：

| 主题 | 出处 |
|------|------|
| 生命周期/register* 资源管理、卸载清理、延迟回调有效性检查 | SKILL.md 实现约束 + compatibility.md「生命周期与共享状态」 |
| 样式隔离（前缀、CSS 变量、禁 !important/innerHTML、跨窗口 DOM） | compatibility.md「样式、窗口和输入」 |
| 文件写入 API（Editor / Vault.process / processFrontMatter）与并发幂等 | compatibility.md「文件、元数据和并发」 |
| 移动端依赖图检查、onload 瘦身、增量索引 | compatibility.md「平台与性能」 |
| 测试矩阵（启用禁用轮次、主题、视图模式、共存组合、双写冲突） | compatibility.md「按功能选择测试矩阵」 |
| 上架政策、manifest 规则、构建产物外置、资产清单、提交流程 | release.md |

## 2. 项目专属约束（技能之外的增量）

1. **甘特库隔离层**：frappe-gantt（或最终选型库）只允许在 `pm-` 前缀根容器内渲染；库样式变量在容器内 override 为 Obsidian CSS 变量；选型时先审计其源码无 `window` 挂载/`document.body` 注入，审计不过则降级自绘。
2. **用户现有 CSS 片段兼容**：用户的 dashboard 依赖 `fullwidth`/`matrix` cssclasses 与 `project-card` 等既有类名——插件类名一律 `pm-` 前缀，**不复用、不覆写**这些选择器。
3. **gantt-builder 共存**：不读取、不写入项目笔记正文中的 `%% gantt-builder:* %%` 标记块；frontmatter 之外的正文一律不碰。F1.7 的「导出到笔记」写入该标记块属例外，实现时必须原子替换且失败不损坏笔记。
4. **数据规则冻结**：status 中文别名、±7 天日期兜底、long-term 豁免、main-project 代表逻辑等业务规则以 `SPEC.md` §2/§4 为准，实现不得擅自增删语义。
5. **参数分离**：所有业务常量（目录、字段名、枚举映射）按 SPEC.md §5 走设置层，代码零硬编码；逻辑字段名（`ProjectItem`）与物理字段名严格分离。
6. **数据安全**：本插件纯本地，禁止引入任何网络请求/遥测/自更新；如未来功能需要，必须先修订本文件并经 Luna 确认。

## 3. 本项目发布口径

- 插件 id 候选：`project-master`（上架前在社区目录查重）；name 遵循 release.md 的 Basic Latin 规则；
- 纯本地插件 README 披露清单：无网络、无账号、无付费、无遥测；
- 发布检查一律执行 release.md 并输出「通过/失败/未验证」三态报告，禁止宣称"保证过审"；
- 无 Obsidian 实机验证的项必须明确标注，不得虚报。

## 4. 参考资料

- 技能：`obsidian-plugin-development`（SKILL.md + references/）
- 官方开发者文档：<https://docs.obsidian.md/>
- 插件提交要求：<https://docs.obsidian.md/community-directory/submission-requirements-for-plugins>
- 开发者政策：<https://docs.obsidian.md/community-directory/developer-policies>
- 官方模板：<https://github.com/obsidianmd/obsidian-sample-plugin>
- Obsidian October 自检清单：<https://docs.obsidian.md/oo/plugin>
