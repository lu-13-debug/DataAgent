# 报告整理与继续分析：服务端验证

验证日期：2026-10-27。对应计划第 2 项；本记录仅覆盖 server 与接口契约，前端交互和浏览器验收由主任务继续执行。

## 本次实现

- `server/report-assets.js` 处理独立报告元数据、来源参数与用户背景继承。元数据使用当前账号 Store 的 `report-metadata` 实体，事务内合并并推进独立 revision。
- `server/app.js` 通过局部 `taskView` 补充元数据，不修改 `workflow.publicTask`，不改任务原件或更新时间。PUT 整理接口不写流水，不推进钱包版本。
- 继续分析使用普通创建端点，来源限定为当前账号完成报告；本次目标、模式、数据、模型和当前会话 Key 继续按原创建流程校验。来源/继承参数进入持久化幂等指纹，仍冻结 20 额度。
- `reportMetadata` / `reportContinuation` 能力在 local/cloud 均声明为 true；原 retry 的来源语义保持不变。

## TDD 与检查结果

1. 实现前运行 local/cloud 元数据与继续分析用例：元数据因接口缺失返回 404，继续分析因缺少 sourceTaskId 断言失败，确认 RED。
2. `node --test server/report-assets.test.js`：11/11 通过。覆盖整理类型和标签边界、去重、空写/同值写、版本递增、重启持久化、同账号会话共享、跨账号拒绝，以及任务/报告/账本原件不变。
3. 继续分析覆盖当前输入与更换数据源、来源数据删除后显式替换、来源状态和越权、仅 user 消息正文继承和新 ID、关闭继承、超界拒绝、当前会话 Key/模型/HTTPS 白名单、幂等重放与冲突、重新冻结/结算、余额/并发校验、直接来源链、重启后幂等记录保留。
4. 最终 `node --test server/*.test.js`：143/143 通过、0 失败。包含原 132 个用例和新增 11 个用例；local/cloud 精确 runtime 能力断言已更新。
5. `git diff --check`（本次涉及的既有服务端与契约文件）：无问题。未新增依赖、未提交、未修改 src/desktop。

测试使用临时 SQLite 工作空间和本机 HTTP 服务；模型请求使用测试供应商响应，不使用真实 Key 或付费外部调用。Node 的 SQLite experimental warning 为原有运行时提示。

## 接口边界

无来源请求继续省略 inheritContext；单独传入该选项返回 400。来源存在时缺省继承等价于 true，false 显式关闭。继承后的初始 messages（含本次系统说明）最多 100 条、用户正文每条最多 3000 字且合计最多 300000 字，超界明确拒绝，不截断。标签按 trim 后 Unicode 字符计最多 20 字；未整理旧报告省略 metadata，同值/空写不创建 revision。

## 2026-10-27：报告资产与探索视图阶段验收

- 本地和云端支持收藏、置顶、标签、筛选、谨慎对比与基于报告继续；旧服务降级到本机保存。实际双窗口测试覆盖跨页同步和并发修改。
- 下钻按源记录重新计算日期与渠道，保留原报告；支持上期比较、批注、表格、CSV、PNG、打印和指标口径。比较不足时不编造差值；探索不新建任务、不额外扣费或调用模型。
- 命令面板覆盖键盘、输入法、焦点和窄屏；支持旧服务能力降级。完整测试 `npm test` 为 233/233，`npm run build` 通过。
- 实际浏览器：`artifacts/report-explorer-1793081549846/result.json`、`artifacts/report-assets-1793081851498/result.json`、`artifacts/report-assets-quality-retest-1793081215170/result.json`，以及 commands、data-first、task-control、wallet-sync、model-settings、accounts、ui-clarity 最新隔离回归均通过。PDF 折叠信息与隐藏图表焦点经 Edge 复验。
- 预览切换前检查无活动任务，SQLite 备份并完整性检查通过，备份在 `backups/before-report-assets-switch-1793083067333`；本地 3002 当前运行独立快照 `.cache/preview-report-assets-1793083017132`。切换会清除内存模型 Key。
- 没有真实付费模型调用，Windows 安装包与云端只读分享仍待后续阶段；没有发布 GitHub 或生成新安装包。
