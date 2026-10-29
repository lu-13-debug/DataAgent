# 数据到首份报告：阶段 1 验证

2026-10-25；属于用户已批准的兼容扩展路线 A，后续阶段尚未完成。

## 本阶段结果

- NewAnalysis 从 Modals 中拆出为“数据 → 问题 → 方式与成本 → 摘要确认”。回退保留输入，标题根据目标和覆盖期间生成且支持手动编辑；只有最终确认创建任务，持续显示 20 额度及独立模型费用。
- 模式、数据源、AI 开关只保存非敏感选择，以 origin/runtime/账号分区。显式预填和本次工具栏选择优先；旧数据源不存在、AI 不可用时明确纠正。
- Dataset 新增可选 inspection：真实 CSV/XLSX 源列映射、全量覆盖/有效行数、缺表影响、结构化问题与实际规则质量分。旧历史数据不推测元数据；已有接口和字段语义保持兼容。
- 上传完成自动进入只读识别确认；问题包含影响指标、修复建议、表/列/源行号，支持复制且不含原始玩家 ID。预览列搜索、类型、空值率明确仅限当前最多 5 行样本。
- 原生 XHR 显示真实传输进度，传输后区分服务器识别阶段；支持取消和可见失败原因，提示取消不能倒推服务器是否已完成存储。提供经过制表符/引号/换行验证的表格粘贴。
- 数据卡片展示覆盖、缺表、规则分和被报告引用数；删除前说明历史报告保留与后续重跑影响。
- 五种分析模板声明数据表要求，缺表禁用；只预填并打开向导，不自动创建任务、不跳过协作确认。

## 文件范围

服务端：`server/inspection.js`、`server/datasets.js`、`server/app.js`、`server/datasets.test.js`、`server/parser.test.js`、`server/app.test.js`、`server/cloud-app.test.js`、`docs/api-contract.md`。

前端：`src/types.ts`、`src/api.ts`、`src/App.tsx`；新 `analysis-draft.ts`、`analysis-templates.ts`、`data-inspection.ts`、`upload.ts`、`use-upload.ts` 及对应测试；新 `NewAnalysis`、`DataPreview`、`DatasetInspection`、`UploadControl`、`AnalysisTemplates` 组件和 `data-workflow.css`；`Modals.tsx`、`Pages.tsx` 接线；`ui.tsx` 增加可选受控关闭并保留焦点陷阱；字号回归加入新样式文件。

验收：`scripts/data-first-check.mjs` 新增，`scripts/ui-clarity-check.mjs`、`scripts/accounts-check.mjs` 适配新向导。未新增依赖，保留此前模型与 UI 改动和用户 `.spec-workflow/`。

## 验证证据

- 完整 `npm test`：**121/121 通过**，0 失败/跳过。
- `npm run build`：TypeScript + Vite 通过，最新阶段构建 `index-fbDcm_p0.js`。
- 阶段流程 Edge cloud/local：`artifacts/data-first-1792933861655/result.json` 通过。涵盖真实上传、中文映射、缺表、样本列搜索、粘贴、取消和失败、输入/回退、模式显式选择优先、焦点/Enter、390px，以及实际仅提交一次任务并结算 20 额度。
- 原 UI 回归：六宽度、cloud/local、示例免费、引导、跨账号、ErrorBoundary、打印与各类弹窗焦点复核通过（最终目录见脚本输出）。
- 双账号真实 CSV/AI 可控响应、报告/额度/密码：`artifacts/accounts-check-1792933028125/result.json` 通过，A 余额 480、B 500，无越权；没有真实付费模型调用。
- 后端独立规格复核通过；质量复核额外完成 144 组 CSV 物理行组合及 20 万行、Key/ID 脱敏与云端隔离。
- 前端独立规格复核通过；质量复核的 3 个 P2 均已实际 RED→GREEN：粘贴 Enter、上传时沿用旧数据推进、创建挂起时关闭/迟到回调。创建挂起时 X/Esc/遮罩均受控，Tab/Shift+Tab 焦点保留；失败后可关闭。
- `git diff --check` 通过。目视检查最终 390px 摘要和识别页面。

没有把本阶段当作整批需求完成：任务摘要/SSE/恢复、报告资产/下钻/命令面板、模型透明度、Windows 能力、云端分享与归因仍在后续阶段。当前分析目标文本不会自动改变确定性计算的数据期间；用户可在摘要看到真实数据覆盖范围，后续查询阶段补充明确筛选。
