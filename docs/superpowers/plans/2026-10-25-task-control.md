# 任务监控、恢复与模型透明度实施计划

用户已批准路线 A；恢复记录另选择 A：新建恢复尝试，保留源任务，确认后重新冻结 20 额度。旧任务、预留记录与唯一交易索引不改写。

**Goal:** 可观察、可恢复且不重复扣额度的任务执行；模型使用和费用来源可解释。

**Architecture:** 新增轻量摘要和经过账号认证的 SSE，普通详情轮询受可见性与超时控制；SSE 在隐藏时保留通知能力。失败/中断任务通过新尝试端点恢复，不复用丢失 Key。模型网关保留现有 string chat 接口，增加受控 usage 回调和错误类别；原字段与端点继续兼容。

**Tech Stack:** 原生 EventSource、Notifications、AbortController、Node EventEmitter 与现有框架，无新依赖。

## 任务 1：服务端摘要、事件与恢复

Files: 新 `server/task-monitor.js` / `server/task-recovery.js`（按责任拆分）、`server/store.js`、`server/workflow.js`、`server/app.js`、`server/cloud-app.js`、新增测试、`docs/api-contract.md`。

- [x] RED：摘要无报告/消息/预览/Key；local/cloud隔离、SSE状态和会话撤销、断开清理；已释放任务恢复的新ID/源ID/再次冻结20/重复请求幂等、不可恢复状态/缺数据/无Key/余额不足拒绝；跳过不能绕过质量/报告/核验。
- [x] `GET /api/tasks/summary` 返回有界 TaskSummary[] 与 wallet；`GET /api/tasks/events` 仅发送摘要+wallet和心跳，初连/重连发送当前快照。使用原同源 Cookie，不在URL放会话令牌。旧 task/bootstrap 保持兼容。
- [x] Store 事务提交后发布变化，SSE连接数有界；cloud增加会话有效性回调，撤销/过期后停止事件，关闭服务及时清理订阅与心跳。
- [x] `POST /api/tasks/:id/retry` 参数 strategy:'restart'|'resume'、useAI、可选 skipSteps 与 clientRequestId，返回新 task/wallet；sourceTaskId记录原任务。仅failed/cancelled可恢复，原记录不改。复用已完成确定性步骤，从失败节点继续时仍可重新核验指标，报告/模型部分不冒充已完成。
- [x] 同一 clientRequestId 不重复建任务或冻结；普通 POST /tasks 也支持可选 clientRequestId，老客户端不传仍兼容。模型凭据只从当前会话重新绑定，并继续验证白名单。
- [x] 单步跳过只允许 retention/monetization/insights 这些可选分支且在执行前批准；跳过后最终报告及模型输入不得保留其计算结果，必须给出明确缺失说明。质量、计划、报告、核验不允许跳过。已结束任务通过新尝试执行。
- [x] 服务重启仍按既有规则释放原冻结额度，恢复需明确创建新尝试，不自动恢复密钥或外部模型请求。
- [x] 规格与质量独立复核，后端local/cloud契约测试通过。

## 任务 2：模型协议、用量与诊断

Files: `server/gateway.js` 及测试、`src/components/ModelSettings.tsx` / `src/components/model-settings.css`、新 `src/model-profiles.ts`、`src/types.ts`、`src/api.ts`。

- [x] RED：保留字符串chat兼容，OpenAI兼容与官方Claude usage的白名单数值透传；Key/原始响应不泄露；拒绝/权限/限流/不支持/截断/推理无最终答复均有稳定类别与可行动中文提示。
- [x] 官方协议仅依据已核对官方文档选择，Claude Messages不能当作ChatCompletions。增强报告可选 usage；未返回明确显示供应商未返回用量；没有对应价格不捏造费用，有人工非敏感价格时只显示估算和来源。
- [x] DeepSeek / Claude / OpenAI 非敏感预设、能力标签只声明可确认能力，不从陌生模型名猜测；配置档案只存地址和模型、按账号/服务分区，不包含Key。换地址仍必须重新填对应Key。
- [x] 不自动向供应商发送测试请求；连接测试和正式生成均由用户明确动作触发。

## 任务 3：可见性、重连、通知与执行界面

Files: 新 `src/use-task-monitor.ts`、`src/task-monitor.ts` 及测试、`src/App.tsx`、`src/components/RunPanel.tsx`、新监控样式、`desktop/main.cjs` 权限策略与测试。

- [x] RED：可见时断网10秒内状态、隐藏停普通轮询、后台不请求全量bootstrap、终态只校准一次、恢复状态不倒退/不重复通知、重复点击不创建多尝试。
- [x] 所有请求有超时和Abort；隐藏时暂停详情/摘要轮询，保留SSE接收后台终态；不支持SSE时使用有界摘要退避。恢复时读取快照/当前任务，终态按taskID去重，集中一次bootstrap校准。
- [x] 完成/失败通知由用户开启并申请权限；拒绝则标题栏提示。通知点击聚焦相应任务。Electron只对所连接可信origin允许notifications，其他权限继续拒绝，不增加远程Node能力。
- [x] 批准前列出后续步骤、数据依赖、产出；报告前列出目标/背景/聚合指标等发送类别且无原始玩家ID明细。
- [x] 失败显示原因，重跑/换模型/仅确定性明确“新任务，重新冻结20额度”；恢复/跳过只显示真实服务端能力，不放假按钮。停止前确认，响应后显示实际释放额度。
- [x] 编写浏览器断线10秒/恢复、visibility、SSE/摘要Network计数、后台通知与双账号、恢复/跳过/账本场景；npm test与npm run build；记录局限与部署代理SSE配置。

## 保留约束

保留前两轮所有未提交改动，逐文件分工，不重写报告历史、不落盘Key、不改变既有API必填字段。任务事件不是模型思维链，界面仅展示实际状态、计划、依据和结果。
