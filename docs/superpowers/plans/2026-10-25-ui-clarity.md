# 界面改进实施计划

**Goal:** 在已确认的三个 A 方案范围内提高专业感、可读性和首次使用完成率。

**Architecture:** 通过前端状态函数统一能力与额度文案；轻量 hook 管理按账号隔离的引导标记；单独的清单与 ErrorBoundary 组件负责新增界面。现有组件仅增加必要回调和状态，不更改 API。

**Tech Stack:** React 19、TypeScript、Lucide、现有 CSS/PostCSS、Node test、Playwright/Edge；无新增依赖。

- [x] 先写失败测试：状态组合、引导存储隔离与异常诊断字段。
- [x] 实现状态函数、清单状态和 ErrorBoundary。
- [x] 实现侧栏、空状态、样例/数据源/帮助入口及新建额度提示。
- [x] CSS 格式化前后 AST 比较；添加字号/色彩 token，替换字号并调整窄屏布局。
- [x] 浏览器验收 cloud/local、引导闭环、例外状态、焦点、诊断、全部断点和打印。
- [x] npm test、npm run build、变更检查；如需，重启当前服务提供新页面。

结果见 [界面改进与验证记录](../../ui-clarity-validation.md)。

## 实施约束

保留工作区已有未提交修改和 .spec-workflow 目录。不新增项目接口、支付能力、云端离线同步或外部资源。打印规则先留存语义快照。原生 clipboard 不可用时显示可选择的安全诊断文本。
