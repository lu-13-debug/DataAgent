# DataAgent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 构建具有协作/自动模式、游戏指标计算、执行动态和报告导出的本地数据分析软件。

**Architecture:** 前后端按 docs/api-contract.md 协作。服务端保存 SQLite 数据与状态、实际计算指标和执行节点；前端轮询真实任务进度，提供报告和任务交互。

**Tech Stack:** Node 24、Express、SQLite、csv-parse、exceljs、React、TypeScript、Vite、Recharts、Lucide。

## Task 1: 后端分析与工作流
Files: server/index.js, server/analytics.js, server/store.js, server/workflow.js, server/model.js, server/datasets.js, server/*.test.js。
- [ ] 先以 node --test 编写并运行缺失功能测试：DAU 去重、D7 未成熟为 null、订单去重、混合币种报错、协作暂停、自动完成、重复 approve 不重复扣费、取消释放。
- [ ] 实现各模块与约定接口，指标测试使用固定三名玩家的可手算数据。
- [ ] 设置返回值只含 hasKey，Key 只在进程内存；测试 key 不出现在数据库文件或 API JSON。
- [ ] node --test server/*.test.js 全部通过。

## Task 2: 前端工作台
Files: src/App.tsx, src/api.ts, src/types.ts, src/components/*, src/styles.css, index.html, vite.config.ts, tsconfig.json。
- [ ] 创建前端契约与网络请求层；以健康检查和 bootstrap 接口获取真实数据。
- [ ] 实现侧栏、工作台、指标、趋势图、留存矩阵、发现和 AI 动态侧栏。
- [ ] 实现新建/上传/数据预览/报告列表/Skill 库/额度/模型设置。
- [ ] 协作确认、追加消息、取消、轮询、错误提示与打印/Markdown 导出。
- [ ] npx tsc --noEmit 和 npm run build 通过。

## Task 3: 联调与交付
Files: README.md, scripts/dev.mjs, scripts/start.ps1, package.json。
- [ ] npm run dev 同时启动两端；npm start 支持生产静态页面。
- [ ] 通过真实 HTTP 验证上传、模式、暂停继续、取消和报告下载。
- [ ] 在浏览器检查桌面/移动、所有导航、弹窗、错误和打印。
- [ ] 进行规格审查及代码质量审查，修复发现。
- [ ] 更新运行说明、验证证据和明确首版本地单用户/试用账本/未进行真实付费 API 验证限制。
