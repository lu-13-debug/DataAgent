# 任务控制与模型透明度验收

验收日期：2026-10-26。用户选择兼容扩展路线 A，恢复策略采用“新建尝试，保留原任务，再次确认冻结 20 额度”。本阶段通过；报告资产、Windows 完整升级和云端分享继续按后续计划实施。

## 结果

- 最终 `npm test`：170/170，通过，日志 `.cache/task-control-tests-final.log`。
- 最终 `npm run build`：通过；前端资源 `index-BBzJX857.js`。
- task-control 浏览器：`artifacts/task-control-1792997850963/result.json`，cloud/local 断网提示均小于 10 秒，后台完成/失败通知、拒绝权限标题提示、跳过商业化、换为确定性恢复、原任务保留、20 额度结算与停止释放均通过，页面异常 0。
- 钱包乱序：`artifacts/wallet-sync-1792997851595/result.json`，cloud/local 分别延迟旧 bootstrap 与 cancel 响应，新任务余额始终为 480、冻结 20，与真实账本一致。
- 数据与向导回归：`artifacts/data-first-1792996401128/result.json`，双 runtime 各创建一次、结算 20，390px/回退/输入/取消/识别确认通过。
- 界面回归：`artifacts/ui-clarity-1792996394576/result.json`，1450/1270/1050/800/600/390px、焦点陷阱、skip-link、存储禁用、ErrorBoundary 与诊断脱敏通过。
- 模型设置回归：`artifacts/model-settings-1792996851029/result.json`，3 次受控生成、0 页面异常；更换地址清空临时 Key、目录检测、配置竞争保护通过。
- 双账号回归：`artifacts/accounts-check-1792996893000/result.json`，数据/报告/额度/会话凭据隔离、改密及重登录通过，无真实付费 Key。

## 独立复核及回归问题

后端摘要、恢复、跳过经过规格与质量复核；钱包版本另有 5 组独立复核。模型协议/用量的规格审查及质量审查通过，额外 8 组边界涵盖响应 2 MiB、无效 JSON、私密错误、未知 usage、档案隔离、读取期间超时和取消。

前端规格实测任务切换在途详情、通知点击焦点、退出后的 SSE/通知清理、双账号和 390px。质量审查发现并关闭 3 个 P2：StrictMode 清理后的旧初始化响应覆盖新任务；终态校准首次失败后只有心跳时不再重试；SSE 虚连时不启动摘要回退。其真实源码 transpile 回归保留为 `src/task-monitor-lifecycle.test.mjs`，先 RED 3/3，修后 GREEN 3/3。隐藏 20 秒且无心跳的独立验证确认 SSE 被重建，而详情/摘要请求数量均不增加。

钱包竞态亦先在真实浏览器 RED，再加入持久账本版本和前端单调合并，4 场景 GREEN。初始/终态 bootstrap、SSE、创建、恢复、批准、取消与跳过均传顶层可选 walletVersion，不改变 Wallet 原三字段。旧服务未声明能力时继续使用兼容详情查询；旧服务没有版本时不能获得新服务的账本顺序保证。

验收脚本的瞬时 toast 和“批准按钮必须短暂消失”已改为实际步骤及报告终态；事件流断开测试改为等待真实服务端 close，取代固定 30ms 猜测。没有修改产品来适配这些时序假设。

## 主要改动文件

- 服务端：`server/task-monitor.js`、`task-recovery.js`、`task-errors.js`、`task-control.test.js`；`store.js`、`workflow.js`、`app.js`、`cloud-app.js` 及相关测试。
- 模型：`server/model-protocol.js`、`gateway.js` 及测试；`src/model-profiles.ts`、`model-cost.ts` 及测试；`components/ModelSettings.tsx`、`ModelUsage.tsx`、`ReportView.tsx`。
- 前端：`src/task-monitor.ts`、`use-task-monitor.ts`、`use-task-actions.tsx` 及测试；`App.tsx`、`api.ts`、`types.ts`；`components/RetryTaskModal.tsx`、`ExecutionPlan.tsx`、`RunPanel.tsx`、`NewAnalysis.tsx`；`task-control.css`。
- 桌面权限：`desktop/permissions.cjs` 及测试、`desktop/main.cjs`。默认只在当前可信主框架请求并经用户确认后开放通知。
- 契约与验收：`docs/api-contract.md`、阶段计划；`scripts/task-control-check.mjs`、`wallet-sync-check.mjs`，及原验收脚本的状态等待更新。

## 边界

终态仅做一次成功的全量校准，临时失败允许退避重试；一般后台监控不按 2.5 秒读取 bootstrap。通知权限由用户开启，浏览器测试使用可控 Notifications；原生权限边界有单测，旧安装包需后续 Windows 阶段重新打包后才能获得新桌面主进程能力。

API Key 仍只在会话内存，恢复不还原丢失凭据。用量仅保留供应商返回的非负整数；费用需要用户填写参考单价，始终标为估算。未使用真实付费模型核对账单，没有公网部署、GitHub 推送或发布新安装包。

协议参考：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat)、[Claude Messages](https://platform.claude.com/docs/en/api/messages/create)、[DeepSeek Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion/)、[Electron 通知权限](https://www.electronjs.org/docs/latest/api/session#sessetpermissioncheckhandlerhandler)。
