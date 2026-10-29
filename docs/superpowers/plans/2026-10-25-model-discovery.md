# 模型连接修复与自动检测实施计划

**Goal:** 修复推理模型测试连接误报，并在填写 API 地址和 Key 后真实获取模型列表。

**Architecture:** 模型网关统一规范基础地址和响应解析；测试连接给出可用的输出预算，允许“已连接但测试只返回推理”的明确提示，正式报告必须存在最终文本。新增只读发现请求，沿用账号认证、白名单、请求并发与会话密钥边界，不保存尚未确认的设置。设置页将 Key 放在模型选择之前，输入停顿后检测，支持刷新、选择、手填，并丢弃过期响应。

**Tech Stack:** React / TypeScript、Express、Node test runner、Playwright / Edge。

## 执行步骤

- [x] 在 `server/gateway.test.js` 和 `server/app.test.js` 先复现小预算、推理空答案、分块文本与截断错误；运行失败用例后实现修复。
- [x] 在 `server/cloud-app.test.js` 添加 `/api/settings/models` 的真实出站格式、临时 Key 不持久化、跨会话拒绝、恶意主机和凭据切换测试。
- [x] `server/model-catalog.js` 实现 GET 模型目录、Claude 版本头和分页、OpenAI/DeepSeek Bearer、响应大小和条目边界；所有请求禁用重定向。
- [x] `server/app.js` 增加模型目录端点：先校验地址和白名单，再选择本请求 Key；只允许原地址使用已保存的会话 Key；查询不修改设置。
- [x] 新增独立 `src/components/ModelSettings.tsx`，保留 `Modals.tsx` 导出接口；`src/api.ts` 和 `src/types.ts` 增加目录类型与请求。
- [x] 新增 `scripts/model-settings-check.mjs`，验证自动检测、自动选择单个模型、列表切换、手填、错误和地址变化后迟到响应；检查窄屏。
- [x] 运行 `npm.cmd test`、`npm.cmd run build`、浏览器脚本和差异检查；重启本机 3002 服务并读取健康及目录路由状态。

## 验收边界

- 不用真实用户 Key 做付费联测；供应商可控响应覆盖推理与目录协议。
- 模型目录内容来自供应商，不内置冒充检测结果的模型名；目录出现不保证支持 Chat Completions，测试连接给出最终判断。
- API Key 不写数据库、日志、localStorage、URL 或错误消息。
- 不重新安装 EXE：现有客户端加载本机服务的新页面。
