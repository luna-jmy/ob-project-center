/**
 * 英文字典（用户口径 2026-09-21：加字典、支持英文版）。
 *
 * **键就是中文原文**，理由见 `translate()` 的注释：迁移成本最低、漏翻自动退回中文、
 * 同一句中文多处出现天然共用一条翻译。中文侧不需要字典——中文原文本身就是基准。
 *
 * 维护约定：
 * 1. 值要**简短**（界面文案不是说明文）；必要时用 `\n` 换行，别写成一大段；
 * 2. 占位符用 `{name}`，与中文原文里的占位符一一对应（`t("已导出 {path}", { path })`）；
 * 3. 改了中文原文 = 改了 key，本文件对应条目要同步改（`tests/i18n.test.ts` 会扫描
 *    源码里所有 `t("…")` 调用的中文，检查字典里有没有对应项，漏了会红）。
 */

/** 分组注释只为方便维护，不参与任何逻辑 */
export const EN: Record<string, string> = {
	// ── 项目状态（模板 suggester 的中文标签，机器值仍是英文）──
	"未开始/待启动": "Not started",
	"起草/构思中": "Drafting",
	执行中: "In progress",
	暂停: "On hold",
	完成: "Done",
	取消: "Cancelled",
	归档: "Archived",

	// ── 优先级 ──
	最高: "Highest",
	高: "High",
	中: "Medium",
	低: "Low",
	最低: "Lowest",

	// ── 设置页：字段映射（左边标题问「这是什么信息」，右边填 frontmatter 字段名）──
	项目识别字段: "Project marker field",
	"这个字段的值等于 project 时，笔记会被识别为项目。":
		"A note counts as a project when this field equals project.",
	项目状态字段: "Status field",
	"未开始 / 起草中 / 执行中 / 暂停 / 完成 / 取消 / 归档。":
		"Not started / drafting / in progress / on hold / done / cancelled / archived.",
	优先级字段: "Priority field",
	"1–5 的数字，1 为最高；导出 Mermaid 时 1、2 会标成关键任务。":
		"1–5, 1 is highest. Priority 1 and 2 are exported to Mermaid as critical tasks.",
	项目开始日期: "Start date field",
	"甘特图的起点。": "Where the Gantt bar starts.",
	项目截止日期: "Due date field",
	"甘特图的终点，也是排序与逾期判断的依据。":
		"Where the Gantt bar ends; also used for sorting and overdue checks.",
	结束日期备用字段: "Fallback end date field",
	"截止日期缺失时用它兜底（模板里的成稿/结束日期）。":
		"Used when the due date is missing (the template's finish date).",
	项目完成日期: "Completion date field",
	"实际完成的那一天。": "The day the project was actually finished.",
	完成进度字段: "Progress field",
	"0–100 的百分比，显示在分组卡片上。": "A 0–100 percentage shown on the card.",
	所属领域字段: "Area field",
	"单个值；按「领域」分组或筛选时用（多值会让分组失效，所以只认一个）。":
		"A single value; used when grouping or filtering by area (several values would break grouping, so only one is kept).",
	所属目标字段: "Objective field",
	"按「目标」分组时用；Mermaid 的分节也按它划分。":
		"Used when grouping by objective; also drives Mermaid sections.",
	场景字段: "Context field",
	"模板里的场景/情境信息，目前只读取、界面上未使用。":
		"Context info from the template. Read-only for now, not shown in the UI.",
	项目负责人: "Project leader field",
	"单个值。": "A single value.",
	项目成员: "Project members field",
	"可以写多个值。": "May hold several values.",
	长期项目标记: "Long-term flag",
	"true / false；开启后豁免全部日期筛选，并且不上甘特图（只在面板里出现）。":
		"true / false. When on, the project skips all date filters and never appears on the Gantt chart (panel only).",
	代表项目标记: "Main project flag",
	"true / false；同一文件夹里有多个项目时，标 true 的那条作为代表卡片。":
		"true / false. When a folder holds several projects, the one marked true represents it.",
	项目编号: "Project ID field",
	"跨笔记关联用的唯一标识，目前只读取。":
		"A unique id for cross-note links. Read-only for now.",
	甘特条颜色: "Bar color field",
	"可写 #ff8800、var(--color-orange) 或颜色名；留空按项目状态用默认色。":
		"Accepts #ff8800, var(--color-orange) or a color name. Empty falls back to the status color.",
	补充识别标签: "Extra recognition tag",
	"笔记的 tags 里含这个标签时也算项目。":
		"A note also counts as a project when its tags contain this tag.",

	// ── 设置页：甘特条配色 ──
	进行中: "In progress",
	"状态为「执行中」的条子；对应 Mermaid 的 active。":
		"Bars whose status is in progress; Mermaid's active.",
	已完成: "Completed",
	"状态为「完成」的条子；对应 Mermaid 的 done。":
		"Bars whose status is done; Mermaid's done.",
	"重要（关键任务）": "Critical",
	"优先级为 1（最高）或 2（高）的条子；对应 Mermaid 的 crit，画成外圈描边。":
		"Bars with priority 1 or 2; Mermaid's crit (drawn with an outline).",
	其他状态: "Other statuses",
	"未开始 / 起草中 / 暂停 / 取消 / 归档等状态共用这一色。":
		"Shared by not started / drafting / on hold / cancelled / archived.",

	// ── 设置页：界面语言（这一行从第一版就双语，见 settings.ts 的说明）──
	界面语言: "Interface language",
	"跟随 Obsidian 的界面语言；也可以在这里强制中文或 English。":
		"Follow Obsidian's language, or force Chinese / English here.",
	"跟随 Obsidian": "Follow Obsidian",
	"界面语言已切换：视图立即生效，设置页重开后全部跟上":
		"Language switched: views update now, the settings page follows once reopened.",

	// ── 筛选层 ──
	"无法识别（frontmatter 里的状态值非法）": "Unrecognized (invalid status value)",

	// ── 设置页：分页标题与页首说明 ──
	全局参数: "Global",
	"扫描范围、项目识别方式与缺日期兜底。改这里会触发一次全库重新索引。":
		"Scan scope, how projects are recognized, and the missing-date fallback. Changes here trigger a full re-index.",
	字段映射: "Fields",
	"项目信息写在 frontmatter 的哪个字段里。左边是「这是什么信息」，右边填「写在哪个字段名里」；换模板只改这张表，不必改插件。":
		"Which frontmatter field holds each piece of project info. The left side says what the info is, the right side where it lives. Switching templates only means editing this table.",
	"留空表示不使用该信息。": "Leave empty to not use that piece of info.",
	枚举与展示: "Enums & badges",
	"状态与优先级在界面上的名字与图标。留空或非法值会被忽略。":
		"Names and icons for statuses and priorities. Empty or invalid values are ignored.",
	视图偏好: "View defaults",
	"打开 dashboard 时的初始状态，以及甘特图自身的显示偏好。":
		"Initial state when the dashboard opens, plus the Gantt chart's own display preferences.",
	"Mermaid 导出": "Mermaid export",
	"导出代码块的格式。临时增删几天假期请用视图主区的 Mermaid 面板；成规模的法定节假日用「法定节假日排期」按年维护。":
		"Format of the exported code block. For one-off holiday tweaks use the Mermaid panel in the view; maintain whole-year holidays under Holidays.",
	法定节假日排期: "Holidays",
	"按年份维护「放假」与「调休上班」。导出时按甘特图跨到的年份自动套用，不必在视图面板里手打每一天。":
		"Maintain days off and makeup workdays per year. The export applies them by the years the chart spans.",

	// ── 设置页：全局参数 ──
	项目扫描目录: "Project scan folders",
	"扫描这些目录下的项目笔记。": "Project notes are scanned under these folders.",
	"每行一个；也可以使用逗号分隔。": "One per line; commas also work.",
	快速项目路径标记: "Quick project path marker",
	"路径中出现这个完整文件夹名的文件夹归入「快速项目」分区（按完整路径段匹配，不做子串匹配）。":
		"Folders containing this exact folder name are grouped as quick projects (matched by path segment, never by substring).",
	"留空 = 只把扫描目录根层的项目算快速项目，新建的快速项目也直接放在扫描目录下。":
		"Empty = only projects at the scan root count as quick, and new quick projects land directly there.",
	"留空 = 只认扫描目录根层": "Empty = scan root only",
	排除目录: "Excluded folders",
	"这些目录不参与索引。Obsidian 配置目录会自动并入，无需手写。":
		"These folders are not indexed. The Obsidian config folder is added automatically.",
	资料子文件夹名: "Materials subfolder name",
	"新建「带文件夹」形态的项目时预建这个子文件夹。留空表示不建：":
		"Pre-created for folder-shaped projects. Empty means don't create it:",
	"资料与项目文档放在同一个文件夹里（资料归集同时收同层与子文件夹里的笔记，留空不影响统计）。":
		"materials then live next to the project note (collection already covers both the folder itself and its subfolders, so empty changes nothing here).",
	"留空 = 资料与项目文档同目录": "Empty = materials next to the note",
	新建项目模板: "New project template",
	"留空 = 与原来一样（只写一行标题）。填模板笔记路径后，新建项目的正文用模板的，模板里缺的字段才由弹窗补上；模板里的 Templater 命令（<% %>）会被执行。":
		"Empty keeps the old behaviour (a single title line). With a template note path, the body comes from the template and only missing frontmatter fields are filled in; Templater commands (<% %>) are executed.",
	"路径填 vault 相对路径（如 900 Assets/910 Templates/TPL-Project），扩展名 .md 可省略。":
		"Use a vault-relative path (e.g. 900 Assets/910 Templates/TPL-Project); the .md extension is optional.",
	"例如：templates/TPL-Project.md": "e.g. templates/TPL-Project.md",
	兼容中文状态别名: "Accept Chinese status aliases",
	"开启后，「执行中」「完成」等模板中文值会被识别为对应状态。历史数据建议保持开启。":
		"When on, Chinese values like 「执行中」/「完成」 from the template are recognized. Keep it on for existing vaults.",
	缺日期兜底策略: "Missing-date fallback",
	"项目缺起始或截止日期时，甘特图如何处理。": "How the Gantt chart treats projects missing a start or due date.",
	"按天数推导（与现有脚本一致）": "Derive from days (matches the old script)",
	"不推导，不上甘特图并提示修复": "Don't derive: keep it off the chart and flag it",
	兜底天数: "Fallback days",
	"仅在「按天数推导」策略下生效（现有脚本硬编码为 7 天）。":
		"Only used by the derive strategy (the old script hard-coded 7).",
	"（默认：{field}；留空表示不使用）": "(default: {field}; empty = not used)",

	// ── 设置页：字段映射页脚 / 枚举页 ──
	"导入 / 导出映射表": "Import / export the mapping",
	"导出为 JSON 便于在多 vault 或换模板时复用；导入内容会先过一遍清洗。":
		"Export as JSON to reuse across vaults or templates; imports are sanitized first.",
	导出: "Export",
	导入: "Import",
	恢复默认: "Restore defaults",
	"映射表 JSON 已复制到剪贴板": "Mapping JSON copied to the clipboard",
	"复制失败：剪贴板不可用": "Copy failed: clipboard unavailable",
	导入字段映射表: "Import field mapping",
	"粘贴字段映射 JSON（逻辑字段名 → 物理字段名）。":
		"Paste mapping JSON (logical field name → frontmatter field name).",
	状态中文别名映射: "Chinese status alias map",
	"中文写法 → 规范状态值。仅在「兼容中文状态别名」开启时生效；指向未知状态的项会被丢弃。":
		"Chinese wording → canonical status. Only active when Chinese aliases are enabled; entries pointing at unknown statuses are dropped.",
	"状态 emoji": "Status emoji",
	"规范状态值 → 徽章 emoji。": "Canonical status → badge emoji.",
	"优先级 emoji": "Priority emoji",
	"优先级值（1–5）→ 徽章 emoji。": "Priority value (1–5) → badge emoji.",
	状态选择顺序: "Status order",
	"编辑 Modal 下拉与筛选 chips 的展示顺序，逗号分隔。合法值：{values}":
		"Display order for the editor dropdown and the filter chips, comma separated. Valid values: {values}",
	"（JSON 对象，改动后自动保存）": "(a JSON object, saved as you type)",

	// ── 设置页：视图偏好 ──
	默认分组依据: "Default grouping",
	按文件夹: "By folder",
	按目标: "By objective",
	按领域: "By area",
	"不分组（按是否有资料）": "No grouping (flat)",
	默认排序: "Default sort",
	"截止日 ↑": "Due date ↑",
	"截止日 ↓": "Due date ↓",
	"开始日 ↑": "Start date ↑",
	"开始日 ↓": "Start date ↓",
	项目名: "Name",
	优先级: "Priority",
	手动排序: "Manual order",
	默认缩放: "Default zoom",
	"各档位的每日像素宽度：日 {day}px / 周 {week}px / 月 {month}px":
		"Pixels per day: day {day}px / week {week}px / month {month}px",
	日: "Day",
	周: "Week",
	月: "Month",
	季度: "Quarter",
	默认年度筛选: "Default year filter",
	"打开视图时「项目开始年度」的默认值。默认只显示本年度启动的项目；改为「不限年度」可一进来就看到全部项目。":
		"Initial value of the start-year filter. The default shows only projects starting this year; pick a different one to see everything at once.",
	只看本年度启动的项目: "This year only",
	"不限年度（显示全部年份）": "All years",
	每项目笔记预览条数: "Notes per project preview",
	"分组卡片里最多显示几条组内笔记；0 表示不限（现有笔记数上限行为）。":
		"Maximum notes listed per card; 0 = unlimited (the old script's cap).",
	面板文字大小: "Panel font size",
	"百分比，100 = 跟随主题默认。只缩放面板卡片里的文字（标题 / 正文 / 注释的层级比例不变），":
		"Percentage, 100 = the theme default. Only scales card text (the heading/body/note hierarchy keeps its ratios), ",
	"可填 {min}–{max}。": "from {min} to {max}.",
	手动排序记录: "Manual order records",
	"面板上拖动分组/项目会记在这里（只有排序档为「手动排序」时生效）。项目改名或删除后可能残留无效项，可一键清空。":
		"Drag-reordering groups or projects in the panel is stored here (only applied when sorting is set to manual). Renamed or deleted projects can leave stale entries behind.",
	清空: "Clear",
	"已清空手动排序记录": "Manual order records cleared",
	条上显示天数: "Days on bars",
	"在甘特条上标出天数。「工作日」= 自然日 − 周末（需在 Mermaid 标签页打开「排除周末」）− 法定节假日排期 + 补班日；与导出 mermaid 的 excludes/includes 是同一份口径。":
		"Show a day count on Gantt bars. Workdays = calendar days − weekends (turn on Exclude weekends in the Mermaid tab) − holidays + makeup workdays, the same rule as the exported excludes/includes.",
	"条子太窄放不下时会挪到条子右侧显示。": "When the bar is too narrow the count moves to its right side.",
	不显示: "Off",
	"自然日（含首尾）": "Calendar days (inclusive)",
	工作日: "Workdays",
	甘特条配色: "Bar colors",
	"只给「Mermaid 里颜色会变」的几类预设颜色，其余状态共用「其他状态」。":
		"Only the classes whose colors change in Mermaid get their own color; the rest share Other statuses.",
	"颜色可写 #3b82f6、var(--color-blue) 或颜色名；点下面的色块即改。":
		"Accepts #3b82f6, var(--color-blue) or a color name; click a swatch below to change it.",

	// ── 设置页：Mermaid 与节假日 ──
	"Mermaid 标题": "Mermaid title",
	"导出代码块里的 title 行（现有脚本为「项目进度甘特图」）。":
		"The title line of the exported code block (the old script used 项目进度甘特图).",
	"Mermaid 无目标分节名": "Mermaid fallback section",
	"项目没有 objective 时落入的分节名（现有脚本为「默认项目」）。":
		"Section used for projects without an objective (the old script used 默认项目).",
	"导出落点标记（开始 / 结束）": "Export markers (start / end)",
	"「导出到笔记」会替换这两个标记之间的内容。默认复用 gantt-builder 的占位块；标记缺失时插件会报错且不改动笔记。":
		"Writing to a note replaces everything between these markers. The defaults reuse gantt-builder's placeholder block; missing markers raise an error and leave the note untouched.",
	还没有排期: "No schedules yet",
	"点下面的按钮添加一个年度，之后按国务院公告填区间即可。":
		"Add a year below, then fill in the ranges from the official announcement.",
	"{year} · 放假": "{year} · Days off",
	"{year} · 调休上班": "{year} · Makeup workdays",
	"区间写成 10-01~10-07（`~`/`至` 都认）；跨年区间如 12-30~01-02 自动算到次年。":
		"Write ranges as 10-01~10-07 (both ~ and 至 work); New-Year ranges like 12-30~01-02 roll into the next year.",
	"这些日子强制算工作日（优先级高于放假），用于把「周六但要上班」从灰色非工作日里捞回来。":
		"These days count as workdays (taking priority over days off), pulling working Saturdays out of the grey.",
	删除该年度排期: "Remove this year's schedule",
	新增年度: "Add a year",
	"每年公告出来后，添一个年度再填区间即可。": "Add a year once the announcement is out, then fill in the ranges.",
	添加年份: "Add year",

	// ── 新建项目弹窗 ──
	新建项目: "New project",
	新项目: "New project",
	项目名称: "Project name",
	"非法字符会被替换为连字符": "Illegal characters are replaced with hyphens.",
	"例如：官网改版": "e.g. Website revamp",
	项目形态: "Project shape",
	"带文件夹的项目把资料/笔记收在自己的子文件夹里；快速项目只放一份文档。":
		"Folder projects keep their notes in their own subfolder; quick projects are a single note.",
	"带文件夹（正常项目）": "With folder (normal project)",
	"不带文件夹（快速项目）": "Without folder (quick project)",
	上级目录: "Parent folder",
	"设置里尚未配置项目扫描目录，请手输创建位置（建议先去设置里补上）":
		"No scan folder configured yet — type the location here (better: add one in settings first).",
	"从设置里的项目扫描目录中选一个": "Pick one of the configured scan folders",
	"取设置里的项目扫描目录": "From the configured scan folder",
	"子文件夹（可选）": "Subfolder (optional)",
	"多级用 / 分隔，例如 2026工作项目；留空 = 直接放在上面的扫描目录下。":
		"Use / for levels, e.g. 2026工作项目. Empty = directly under the scan folder above.",
	"留空 = 放在扫描目录下": "Empty = under the scan folder",
	"同时创建资料子文件夹": "Also create the materials subfolder",
	"未设资料子文件夹名（资料与项目文档放同一个文件夹），不会预建子文件夹。":
		"No materials subfolder name set (materials sit next to the note), so nothing is pre-created.",
	"将创建：{path}（快速项目{extras}）": "Will create: {path} (quick project{extras})",
	"将创建：{path}{extras}": "Will create: {path}{extras}",
	"，直接放在该目录下": ", placed directly in that folder",
	"；缺「{marker}」文件夹会自动新建": "; the 「{marker}」 folder is created if missing",
	"，并预建「{name}」子文件夹": ", plus a 「{name}」 subfolder",
	状态: "Status",
	"（未设置）": "(not set)",
	开始日期: "Start date",
	截止日期: "Due date",
	"目标（objective）": "Objective",
	"甘特图按它分节": "Drives the Gantt sections",
	领域: "Area",
	"多个值用逗号分隔": "Separate multiple values with commas",
	创建: "Create",
	创建并打开: "Create & open",
	"请填写项目名称。": "Please enter a project name.",

	// ── 编辑项目弹窗 ──
	"对齐模板的中文标签 + 英文值": "Label from the dictionary, canonical English value in frontmatter",
	"实际完成日": "Completion date",
	进度: "Progress",
	"0–100；留空表示未设置。状态改成「完成」时会自动填 100，可再手动改":
		"0–100; empty = not set. Switching the status to done fills in 100, which you can override.",
	未设置: "Not set",
	长期项目: "Long-term project",
	"开启后豁免全部日期筛选，并且不上甘特图——只在面板里出现（没有确定的时间边界）":
		"When on, the project skips all date filters and stays off the Gantt chart — it only shows in the panel, since it has no fixed time boundaries.",
	主项目: "Main project",
	"同文件夹多个项目时，作为该文件夹的代表卡片":
		"Represents its folder when several projects live there.",
	保存: "Save",
	打开笔记: "Open note",
	清除项目标记: "Clear project marker",
	"仅从插件管理中移除（删除 type 字段），不会删除笔记":
		"Only removes it from the plugin (deletes the type field); the note itself is kept.",
	"再点一次确认清除": "Click again to confirm",
	备注: "Remark",
	"单个值；按领域分组与筛选都看这一个":
		"Single value — area grouping and filtering both key off it",
	"拖动调整侧栏宽度": "Drag to resize the sidebar",
	"拖动调整侧栏宽度（方向键也能调）": "Drag to resize the sidebar (arrow keys work too)",
	"随手记状态变更、决策、卡点；存进 frontmatter 的备注字段。":
		"Jot down status changes, decisions or blockers; stored in the frontmatter remark field.",
	点一下追加: "Click to add",
	点一下移除: "Click to remove",
	备注字段: "Remark field",
	"多行备注，随手记状态变更、决策、卡点；编辑弹窗底部可以改。":
		"A multi-line remark for status changes, decisions or blockers; editable at the bottom of the editor.",
	"点色块选主题色；也可直接填 #ff8800、var(--color-blue)、颜色名。留空则按项目状态用默认色。":
		"Click a swatch for a theme color, or type #ff8800, var(--color-blue) or a color name. Empty uses the status color.",
	"默认（按状态）": "Default (by status)",
	"Mermaid 导出不支持逐任务配色，该颜色只影响自绘甘特图。":
		"Mermaid export has no per-task colors; this one only affects the built-in Gantt chart.",

	// ── JSON 输入弹窗 / 选择笔记 ──
	应用: "Apply",
	"内容为空。": "Content is empty.",
	"需要是一个 JSON 对象（以 { 开头）。": "Needs to be a JSON object (starting with {).",
	"JSON 语法错误：{reason}": "JSON syntax error: {reason}",
	"选择要写入 Mermaid 的笔记（其标记块内内容会被替换）":
		"Pick the note to write Mermaid into (the content inside its markers gets replaced)",

	// ── 视图外壳：工具栏 / 统计 / Tab / 提示 ──
	项目中心: "Project center",
	刷新: "Refresh",
	分组依据: "Group by",
	按文件夹分组: "By folder",
	按目标分组: "By objective",
	按领域分组: "By area",
	"不分组（按资料情况）": "No grouping (flat)",
	时间粒度: "Zoom level",
	恢复缩放: "Reset zoom",
	全部展开: "Expand all",
	全部收起: "Collapse all",
	展开侧栏: "Show sidebar",
	收起侧栏: "Hide sidebar",
	展开筛选: "Show filters",
	收起筛选: "Hide filters",
	面板模式: "Panel mode",
	退出面板模式: "Exit panel mode",
	甘特图: "Gantt",
	"Mermaid 预览": "Mermaid preview",
	// 月 / 周 / 日 已在设置页段定义（同一句中文共用一条翻译），最粗一档是「季度」
	"{unit}刻度": "{unit} scale",
	"时间粒度：{unit}刻度": "Zoom: {unit} scale",
	自定义: "Custom",
	不限: "Any",
	"已切换为「手动排序」": "Switched to manual order",
	"当前没有展开的项目可导出（折叠的分节不会进导出）。":
		"Nothing to export: every section is collapsed (collapsed sections are skipped).",
	"该项目缺起止日期，无法在甘特图上定位": "This project has no start/due dates, so it can't be located on the chart.",
	"该项目标记为长期项目，按设计不上甘特图（可在面板卡片上点「编辑」修改）":
		"This project is marked long-term, so by design it stays off the chart (edit it from its panel card).",
	"「{name}」已保存，但甘特图上不会显示它：{reason}":
		"「{name}」 was saved, but it won't show on the Gantt chart: {reason}",
	"（未上甘特图：{parts}）": "(not on the chart: {parts})",
	"「缺日期」需补全起止日期；「长期项目」按设计只出现在面板（它没有确定的时间边界）":
		"Missing dates can be filled in; long-term projects only appear in the panel by design (they have no fixed time boundaries).",
	"年度筛选按项目的开始/截止日期所在年份严格匹配；没有对应日期的项目不会被计入任何年度。":
		"The year filter matches the year of the start/due date exactly; projects without those dates land in no year.",
	"「隐藏已完成」这一档同时还隐藏「取消」与「归档」；把状态档改成「全部」即可看到它们。":
		"This preset also hides cancelled and archived projects; switch the status preset to all to see them.",
	"复制失败：剪贴板不可用，请改用「写入笔记」":
		"Copy failed: clipboard unavailable — use Write to note instead.",
	"打开项目中心": "Open project center",
	重建项目索引: "Rebuild project index",
	"时间轴：放大（更细）": "Timeline: zoom in (finer)",
	"时间轴：缩小（更粗）": "Timeline: zoom out (coarser)",
	"时间轴：恢复缩放": "Timeline: reset zoom",

	// ── 面板：筛选栏 / 分组 / Mermaid ──
	搜索: "Search",
	日期: "Dates",
	年度: "Year",
	开始: "From",
	结束: "To",
	排序: "Sort",
	清除筛选: "Clear filters",
	"清除全部筛选条件，显示所有项目": "Clear every filter and show all projects",
	快速项目: "Quick projects",
	"快速项目（根目录）": "Quick projects (scan root)",
	"没有符合当前筛选条件的项目": "No projects match the current filters",
	"带资料的项目": "Projects with notes",
	"不带资料的项目": "Projects without notes",
	"该文件夹有多个项目笔记，但没有标记 main-project: true":
		"This folder holds several project notes but none is marked main-project: true",
	"快速项目：没有自己的项目文件夹，资料直接放在快速项目文件夹里":
		"Quick project: it has no folder of its own, so its notes live in the quick-project folder",
	暂无资料: "No notes yet",
	编辑: "Edit",
	"该项目文件夹及其子文件夹里的普通笔记（不含项目文档本身）":
		"Plain notes in this project's folder and its subfolders (excluding the project note itself)",
	今天线: "Today marker",
	"导出的代码里保留今天的竖线": "Keep today's vertical line in the exported code",
	排除周末: "Exclude weekends",
	"把周六周日标成非工作日：自绘甘特图与导出的图都会把它们画成灰色列。\n注意：任务条长度始终按起止日期算（自然日），不会因为跳过周末而缩短——mermaid 只在任务写成「时长」时才会按工作日重排。":
		"Marks Saturdays and Sundays as non-working: both the built-in chart and the export draw them grey.\nNote: bar length always follows the start/due dates (calendar days) and does not shrink when weekends are skipped — mermaid only re-lays out workdays for duration-based tasks.",
	排除日期: "Excluded dates",
	"临时补充的排除日期。支持区间 2026-10-01~2026-10-07（也认「至」），多条用逗号分隔；这些日子在图上会画成灰色的非工作日。\n成规模的法定节假日建议在设置里按年份维护「法定节假日排期」，导出时会自动套用。":
		"One-off excluded dates. Ranges like 2026-10-01~2026-10-07 work (至 too); separate several with commas. They show as grey non-working days.\nFor whole-year holidays maintain them per year in the settings.",
	调休上班: "Makeup workdays",
	"临时补充的调休补班日。写法同上；这些日子强制算工作日（优先级高于排除），用于把「周六但要上班」从灰色里捞回来。\n年度排期里的补班日会自动套用，这里只填例外。":
		"One-off makeup workdays, same syntax. They always count as working days (taking priority over exclusions), pulling working Saturdays out of the grey.\nYearly schedules are applied automatically; put only exceptions here.",
	"导出 SVG": "Export SVG",
	"把预览里的图存成矢量图（.svg）：放大不糊，也能再拿去别的工具里改":
		"Save the diagram as vector graphics (.svg): sharp at any zoom, and editable in other tools",
	"导出 JPG": "Export JPG",
	"把预览里的图存成位图（.jpg，2 倍分辨率、底色跟随主题）：适合贴进聊天或文档":
		"Save the diagram as a bitmap (.jpg, 2× resolution, theme background): handy for chats and documents",
	"导出代码": "Export code",
	"复制当前预览的 Mermaid 代码": "Copy the Mermaid code of the current preview",
	"写入笔记": "Write to note",
	"覆盖指定笔记的落点标记之间的内容（标记可在设置里改）":
		"Replaces the content between the markers in the chosen note (markers are configurable)",
	"预览里还没有可导出的图，等它渲染完再点一次":
		"The preview has no diagram yet — click again once it has rendered",
	"Mermaid 的 gantt 语法不支持逐任务配色，自定义颜色只影响左侧自绘甘特图，导出时会忽略。":
		"Mermaid's gantt syntax has no per-task colors; custom colors only affect the built-in chart and are ignored on export.",

	// ── 甘特侧栏 / 跳过原因 / 服务层提示 ──
	"没有可显示的项目（可能被状态/领域/日期筛选或年度过滤挡掉了）":
		"Nothing to show (the status/area/date filters or the year filter may be hiding everything)",
	拖动调整项目顺序: "Drag to reorder projects",
	拖动调整分节顺序: "Drag to reorder sections",
	缺日期: "No dates",
	"该项目起止日期不完整，甘特图上为推导值；请编辑补全真实日期":
		"This project's dates are incomplete; the chart uses derived values — edit it to fill in the real ones",
	"它标记为长期项目，按设计不上甘特图（面板里照常显示）":
		"It's marked long-term, so by design it stays off the chart (the panel still shows it)",
	"它没有起止日期，甘特图上无法定位（补上日期即可）":
		"It has no start or due date, so it can't be placed on the chart (adding dates fixes that)",
	红: "Red",
	橙: "Orange",
	黄: "Yellow",
	绿: "Green",
	青: "Cyan",
	蓝: "Blue",
	紫: "Purple",
	粉: "Pink",
	"隐藏已完成/取消/归档": "Hide done/cancelled/archived",
	"仅已完成/取消/归档": "Done/cancelled/archived only",
	全部: "All",
	"它的状态是「{label}」，被状态档「{preset}」排除了（状态档改成「全部」就能看到）":
		"Its status is 「{label}」, hidden by the 「{preset}」 preset (switch the preset to all to see it)",
	"年度筛选（{state}）与它的起止日期不符（年度档改成「不限」就能看到）":
		"The year filter ({state}) doesn't match its dates (pick a wider year range to see it)",
	"日期区间筛选把它排除了（区间改成「不限」就能看到）":
		"The date range excludes it (set the range to all to see it)",
	"领域筛选把它排除了（清空领域选择就能看到）":
		"The area filter excludes it (clear the area selection to see it)",
	"名称搜索词与它不匹配（清空搜索框就能看到）":
		"The name search doesn't match it (clear the search box to see it)",
	"被多个筛选条件同时排除（筛选栏的「清除筛选」可以一次全部放开）":
		"Several filters exclude it at once (Clear filters in the filter bar releases them all)",
	"内部错误：待写入内容未包含落点标记，已放弃写入（笔记未修改）。":
		"Internal error: the content to write had no markers, so nothing was written (the note is unchanged).",
	"模板命令未全部执行，笔记已按模板原文创建；可稍后执行一次模板命令重跑":
		"Some template commands didn't run; the note was created from the template as-is. You can re-run the template later.",
};
