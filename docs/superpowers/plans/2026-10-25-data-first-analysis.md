# 数据到首份报告实施计划

> 使用 subagent-driven-development 按任务实施，先规格复核，再质量复核。用户已选择路线 A，不在各任务之间重复请求继续。

**Goal:** 数据、问题、方式与费用在创建任务之前可核对，上传识别结果真实可追溯，模板仅预填。

**Architecture:** 服务端在现有 Dataset 上增加可选 inspection，公开真实源字段映射、覆盖范围和结构化问题；旧数据明确显示未记录。前端共享 DatasetInspection / UploadControl，NewAnalysis 独立为向导组件，保留 Modals 导出兼容。所有记忆按服务/runtime/账号分区，API Key 不持久化。

**Tech Stack:** 现有 React/TypeScript/Express/node:sqlite、原生 XHR/AbortController、Lucide、CSS；无新增依赖。

## 任务 1：识别元数据与分析前验证

Files: `server/datasets.js`、新 `server/inspection.js`、`server/app.js`；测试新 `server/inspection.test.js` 以及现有 parser/app/cloud-app 测试；契约 `docs/api-contract.md`。

- [x] 失败测试先覆盖中文源列映射、XLSX 表/来源、缺支付表的指标影响、重复数据定位、全量有效行数、全未来日期、旧数据兼容与无原始 ID 泄漏。
- [x] 定义可选 inspection：version、mappings、coverage、missingTables、issues、quality、analyzable、rawRows、validRows。issues 提供 code/severity/problem/metrics/fix/location，定位仅表/列/行号，不带原始 ID/单元格明细。
- [x] 在解析时保留 sourceColumn 和文件/工作表名，归一化之前捕获来源行号。生成数据明确 origin=generated；旧数据不冒充有源映射。
- [x] 保留旧字段语义，score 复用服务端实际分析的明确规则，无法分析为 null。任务创建前验证可分析性，失败不冻结。
- [x] 服务端 local/cloud 测试通过，规格/质量复核。

验证示例：
```js
const dataset = await parseFiles([{ originalname: 'users.csv', buffer: Buffer.from('玩家ID,注册日期\nu1,2026-10-01\n') }]);
assert.equal(dataset.inspection.mappings.find(m => m.field === 'user_id').sourceColumn, '玩家ID');
assert.ok(dataset.inspection.missingTables.includes('payments'));
assert.equal(JSON.stringify(dataset.inspection).includes('u1'), false);
```

## 任务 2：数据确认与上传体验

Files: `src/types.ts`、新 `src/data-inspection.ts` / `src/upload.ts` / `src/use-upload.ts`、新 `src/components/DatasetInspection.tsx` / `DataPreview.tsx` / `UploadControl.tsx`、`src/components/Modals.tsx` / `Pages.tsx` / `App.tsx`、新 `src/data-workflow.css`、测试 `src/data-workflow.test.mjs`。

- [x] 先失败测试：缺表影响、样本类型/空值率、只读列搜索、粘贴 TSV→CSV 引号/换行、旧 metadata 降级、模板数据要求。
- [x] 上传进度由 XHR.upload 产生，100% 后显示识别中；AbortError 不改写为网络错误。XHR 保持 credentials 与 session 401 处理。取消后不以“已删除”误报服务端结果。
- [x] 统一上传控制：选文件/粘贴纯文本、传输进度、取消、失败原因持久可见；沿用最多 3 文件、总 20MB、原 CSV 校验。粘贴仅在完整测试后开放。
- [x] 上传返回后弹出确认：自动识别的只读映射、全量诊断、修复建议和复制。预览搜索按列，类型/空值率明确只基于当前最多 5 行样本。
- [x] 卡片使用服务器覆盖/评分，旧数据写“未记录”，以任务数据集 ID 统计引用报告数；删除前说明历史报告保留但不能从此数据集重跑，运行中保持服务器拒绝删除。

验证示例：
```js
assert.equal(profileColumn([{amount: 1}, {amount: null}], 'amount').emptyRate, 50);
assert.equal(pasteToCsv('玩家ID\t注册日期\nu1\t2026-10-01').includes('玩家ID,注册日期'), true);
assert.match(missingTableImpacts(['users', 'activity']).join('；'), /收入、ARPPU、付费人数不可计算/);
```

## 任务 3：三步加摘要确认向导

Files: 新 `src/components/NewAnalysis.tsx`、新 `src/analysis-draft.ts`、`src/components/Modals.tsx` 导出接线、`src/App.tsx`、`src/data-workflow.css`、测试 `src/analysis-draft.test.mjs`。

- [x] 先失败测试：目标建议不阻断、自动标题、手动编辑保留、按账号记忆、过期数据集/AI 能力纠正、模板/报告预填优先。
- [x] 步骤：0 数据含识别确认 → 1 问题/背景/标题 → 2 模式对比/AI发送类别/成本 → 3 摘要确认。所有输入状态位于向导顶层，退回不卸载草稿。背景与目标合并为现有 goal 提交，不引入必填 API 字段。
- [x] mode 与 AI 独立，明确两种模式的中途确认次数、计算方式、产出；固定费用文案，不足20额度禁最终提交。仅最终按钮 POST /tasks。
- [x] 记忆只含 mode/datasetId/useAI，按 origin/runtime/userId 分区；从模板/报告显式预填优先。手动标题编辑后不随目标覆盖。
- [x] Enter 下一步、Shift+Enter 换行、IME 不拦截；摘要不以泛 Enter 创建任务。步骤标题 focus，Modal 保持焦点陷阱。

## 任务 4：五种分析模板

Files: 新 `src/analysis-templates.ts` / `src/components/AnalysisTemplates.tsx`、`src/components/ReportView.tsx` / `App.tsx`、样式与纯逻辑测试。

- [x] 留存诊断(users/activity)、渠道质量(users/activity)、付费转化(users/activity/payments)、版本对比(users/activity)、活动复盘(users/activity/payments)。模板声明实际可计算观察性范围，不声称版本/活动因果数据已经存在。
- [x] 显示推荐问题、所需表、输出；无满足条件的数据集时禁用并列出缺表。选择仅预填并打开向导，不提交、不跳过确认，不改变8步工作流。

## 任务 5：端到端验收与阶段记录

Files: 新 `scripts/data-first-check.mjs`、现有 `scripts/ui-clarity-check.mjs` 适配向导、新 `docs/data-first-validation.md`。

- [x] cloud/local 实际上传 CSV/XLSX、确认映射、缺表/必填错误、预览样本说明、模板禁用、输入/回退、记忆隔离、20额度只创建一次。
- [x] 模拟上传中取消/失败、粘贴制表符和引号；390px 无页面/弹窗横向溢出，焦点/键盘/IME/aria-live 和打印回归。
- [x] 运行 npm test 与 npm run build，检查 git diff --check，阶段结果写入记录。测试失败先定位修复，不声称完成。

后续四阶段仍属于已批准路线 A，本计划完成后继续编制并推进，不将第一阶段交付冒充整批目标完成。
