# 报告资产、下钻与键盘操作实施计划

> **For agentic workers:** Use subagent-driven-development，按任务先规格后质量复核。用户已选择兼容扩展路线 A，沿用当前分支，保留原改动；不自动提交、发布或新增依赖。

**Goal:** 报告能整理、比较、继续分析和导出；筛选结果基于真实记录重算，键盘可以完成主要操作。

**Architecture:** 元数据按服务账号持久化；报告原件不可变，探索是无模型调用、不扣服务额度的派生视图。新增可选 capability 与端点，旧服务降级且清楚标明限制。命令面板复用现有 Modal 焦点陷阱。

**Tech Stack:** 现有 React/TypeScript/Recharts、Express/node:sqlite、原生 worker_threads、SVG/Canvas、localStorage，无新增依赖。

## 1. 探索计算与兼容 API

Files: `server/analytics.js`、新 `server/report-explore.js`、新 `server/report-worker.js`、新 `server/report-assets.test.js`、`server/app.js`、`server/task-monitor.js`、`docs/api-contract.md`。

- [ ] RED：同一玩家跨日付费的 ARPPU 按期间唯一玩家数；渠道筛选用注册渠道匹配事件，不能从 daily 相加推测；原数据覆盖外为 null，覆盖内无事件为零。
- [ ] `analyze(dataset, {range:{start,end},channels:string[],now})` 为内部可选扩展。无范围时现有测试/字段语义保持不变；选择范围限制统计事件和注册 cohort，不截掉范围之外用于 D1/D7 成熟观察的原活跃数据。
- [ ] 每个选中渠道的归属由完整注册表确定；期间新增只数期间注册玩家，期间收入包含该渠道所有已注册玩家在期间的成功订单。没有注册表时拒绝渠道筛选并说明补表；不把未匹配玩家归入已知渠道。
- [ ] 原表覆盖先由完整记录和报告 generatedAt 推导，再过滤事件；不把选中渠道的首次/末次事件当覆盖边界。十年日期跨度、日期合法性、渠道数量/长度均有限制。
- [ ] `POST /api/tasks/:id/explore {start,end,channels?:string[],comparePrevious?:boolean}` 只接受已完成、仍有源数据的报告，返回 `{report,scope,previous?,comparison}`；从原 task 继承 skippedSteps，绝不恢复用户跳过的指标。失败用兼容 `{error}`；数据源已删返回明确原因。
- [ ] 上期为等长相邻自然日区间，按同一渠道和口径重新计算。覆盖不足、未成熟、分母为零时解释原因且不算误导差值；报告 metrics 的原 change 不冒充上期比较。
- [ ] 派生 findings/summary 是确定性引擎结果，不拼接原 AI 结论。返回显式统计范围/时区/版本/比较限制，不改原 Task.report 或历史账本，不调用模型。
- [ ] 运算放工作线程，账号内并发有界；源数据只在服务端进程和 worker 间传递，不回传玩家 ID。关闭服务/请求取消清理 worker；缓存有界且按任务+范围+渠道分区。
- [ ] 测试 cloud/local 认证与越权、旧客户端兼容、无模型/无收费、跨表范围、样本不足、只有支付表、跳过分支和重启后原件不变。

## 2. 报告元数据与继续分析

Files: 新 `server/report-assets.js`、`server/app.js`、`server/task-monitor.js`、`src/types.ts`、`src/api.ts`、`src/analysis-draft.ts`、`src/components/NewAnalysis.tsx`、`src/App.tsx`。

- [ ] `PUT /api/tasks/:id/metadata {favorite?:boolean,pinned?:boolean,tags?:string[]}`，返回 `{task}`，元数据在原账号 Store 内保存；最多 8 标签，每项 20 字，去重去空，不信任额外字段。Task 可选 `metadata`，旧报告缺省空。
- [ ] 普通 `POST /api/tasks` 的可选 sourceTaskId 仅接受本账号 completed 来源；显式保留来源链，继承原用户业务背景，不复制 Key/内部缓存。收费仍经已有幂等创建，最终摘要确认后才发送。
- [ ] NewAnalysis 接受来源报告的目标、数据、业务背景预填且可改；展示来源报告名/编号，输入回退保留。来源与目标/数据改变不假称结果可比。
- [ ] 旧服务 capability 缺失时收藏/标签可按 origin/runtime/userId 降级本机保存并明示“仅此设备”；不展示不存在的云端保存能力。

## 3. 报告列表、保守比较与证据

Files: 新 `src/report-assets.ts` 与测试、新 `src/components/ReportsPage.tsx`、新 `src/components/ReportComparison.tsx`、`src/components/Pages.tsx`、`src/components/ReportView.tsx`、新 `src/report-assets.css`。

- [ ] 列表搜索、收藏/置顶、标签、数据源、全部状态、开始/结束日期筛选；置顶优先、其次生成时间。日期按 Asia/Shanghai，空结果有清除筛选入口。
- [ ] 最多选两份 completed 报告，原数据源 ID、期间、币种、指标 ID/单位/口径及 methodology 全部确认一致才算差值；否则醒目“不可直接比较”并列实际不一致项，仍可并排阅读。
- [ ] 比例差用百分点、数值差带原单位；null 不当零，原报告不产生新因果结论。比较弹窗窄屏纵向排列但每项两份报告有文本列名。
- [ ] 完整报告“基于此继续”，来源链可定位；关键口径为展开区，正文和图表不依赖悬停。
- [ ] evidence 至少可以定位并高亮文本，点击后实际滚动焦点；能确认日期/指标/渠道匹配才联动表格或图，不伪造精确血缘。

## 4. 探索视图与本机批注

Files: 新 `src/use-report-explorer.ts`、新 `src/components/ReportExplorer.tsx`、`src/components/ReportView.tsx`、新 `src/report-explorer.ts` 与测试、样式。

- [ ] 显式日期输入与 Recharts Brush 同步；筛选状态可见，可清除回原报告。请求取消与序号保护，切换任务后迟到结果不得覆盖新报告。
- [ ] 同一派生 report 传入指标卡、发现、留存、渠道、趋势及导出；“对比上一周期”带明确区间和限制，虚线表示上期，不能仅靠颜色。
- [ ] 渠道 chip 基于原报告渠道；缺注册表/覆盖不足/空样本给原因与补充建议。无探索 capability 时保留原报告表格，不放假筛选。
- [ ] 批注只存 origin/runtime/userId/taskId 的 localStorage，时间、类型（版本/活动）、文字都有边界。明确“批注只影响展示与解读上下文，不参与计算”；不改引擎数值，不自动收费或发模型。
- [ ] 图表/表格切换；表格可键盘访问全部值，图表焦点与方向键显示当天 tooltip，日期与序列有文本。无效值显示无数据，未成熟 cohort 有解释。

## 5. 导出当前视图

Files: 新 `src/report-export.ts` 与测试、`src/components/ReportView.tsx`、`src/App.tsx`、桌面下载过滤器稍后阶段更新。

- [ ] 指标/渠道/留存 CSV 使用当前 report 与范围；CSV 单元格按 RFC 引号转义，危险公式前缀用文本保护，UTF-8 BOM；文件名清理 Windows 保留字符并包含报告名与期间。
- [ ] 当前趋势 SVG 序列化到 Canvas 导出 PNG，内联样式/背景/中文系统字体，不依赖网络资源。导出失败有可行动提示，未挂载图表时先切至图表或提供表格导出。
- [ ] 筛选激活时 Markdown/PDF 不伪装原始报告：明确下载原始 Markdown，打印使用当前视图并标记筛选；CSV/PNG 保留当前范围文字。

## 6. 命令面板与快捷键

Files: 新 `src/commands.ts` 与测试、新 `src/components/CommandPalette.tsx`、新 `src/components/ShortcutHelp.tsx`、`src/App.tsx`、`src/components/HelpModal.tsx`、新 `src/commands.css`。

- [ ] Ctrl/Cmd+K 打开/关闭，输入匹配页面/报告/数据/Skill/动作；模糊子序列排序，精确前缀优先，最近使用仅存命令 ID，按账号/服务分区，失效 ID 自动忽略。
- [ ] combobox 的 aria-expanded/controls/activedescendant 与 listbox/option/selected 一致；↑↓循环、Enter执行、Esc关闭、空结果解释，Modal 焦点陷阱及关闭还原焦点。
- [ ] 动作包括新建、两种默认模式、模型设置、当前报告导出、帮助；只显示当前可执行动作，打开其他弹窗先关闭命令面板。
- [ ] N/? 单键不在 input/textarea/select/contenteditable 或其他弹窗内触发；所有快捷键忽略 isComposing/229 与修饰键冲突；? 显示全部键盘说明，帮助内也可打开。

## 7. 阶段验收

- [ ] 每项 RED→GREEN 并完成独立规格/质量复核；`npm test`、`npm run build` 全通过。
- [ ] 浏览器真实 local/cloud：整理保存/刷新与账号隔离、对比不可比、继续预填及收费确认、范围/渠道正确联动/清除/请求竞态、上期覆盖边界、批注隔离、CSV/PNG 文件实际内容、键盘/IME/焦点、390px 无横向滚动、打印仍可读。
- [ ] 重跑 data-first、task-control、wallet-sync、model-settings、ui-clarity、accounts 回归；不使用真实 Key 付费联测。
- [ ] 记录实际产物与未完成 Windows/分享项，再进入下一阶段。所有成功声明以本阶段最新命令输出为准。
