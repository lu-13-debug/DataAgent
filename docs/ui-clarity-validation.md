# 界面改进与验证记录

日期：2026-10-25。范围以用户确认的 1A、2A、3A 为准。

## 实现结果

- 侧栏使用“工作空间 / 游戏运营”，打开领域说明；最近分析新增“查看全部分析”。额度提示使用 Info 图标。
- 没有任务时显示明确的开始状态和新建入口；服务连接、AI 开放、Key 配置、服务额度分别表达，额度不足 20 时禁止提交新分析。
- 首次使用提供三步清单：阅读示例、上传或选择数据、生成第一份报告。支持持久关闭、完成后隐藏及帮助重开。云端按服务地址和账号隔离，本地单独保存；存储内容只有布尔标记。
- 示例报告明确标注数据性质和免费阅读。协作入口提供只读说明；开始真实分析必须经过显示 20 额度的新建弹窗确认。数据源页可加载示例并返回示例报告。
- 根部 ErrorBoundary 提供重新载入、复制诊断信息及复制失败后的手动文本。诊断只含固定错误码、版本、受控异常类型、时间，不包含异常原文、堆栈、URL、Key 或业务数据。
- CSS 先按块格式化，再统一字号 token、文本色和窄屏布局。信息文本至少 11px，正文至少 13px，中文正文行高 1.75；布局通过换行和调整列数适配。点击示例后滚动位置会避开固定顶栏。

本轮没有新增依赖、外部字体、API 或服务端改动。已有模型发现、白名单和账号服务修改保留。skip-link、弹窗焦点陷阱、aria-live、减弱动画规则和原有打印规则保留。

## 本轮改动文件

| 范围 | 文件 |
| --- | --- |
| 应用接线、空间与能力状态 | `src/App.tsx`、`src/main.tsx`、`src/product-state.ts`、`src/components/Sidebar.tsx`、`src/components/RunPanel.tsx` |
| 页面、示例与帮助 | `src/components/Pages.tsx`、`src/components/ReportView.tsx`、`src/components/Modals.tsx`、`src/components/HelpModal.tsx` |
| 首次使用引导 | `src/onboarding.ts`、`src/use-onboarding.ts`、`src/components/OnboardingChecklist.tsx` |
| 异常恢复与安全诊断 | `src/diagnostics.ts`、`src/components/AppErrorBoundary.tsx` |
| 字号、色彩与布局 | `src/styles.css`、`src/readability.css`、`src/accounts.css`、`src/components/model-settings.css`、`src/experience.css` |
| 自动验证 | `src/ui-clarity.test.mjs`、`src/typography.test.mjs`、`scripts/ui-clarity-check.mjs` |
| 设计、计划与记录 | `docs/superpowers/specs/2026-10-25-ui-clarity-design.md`、`docs/superpowers/plans/2026-10-25-ui-clarity.md`、本文件 |

工作区原有未提交的模型功能修改与 `.spec-workflow/` 均保留，没有一并重构或发布。

## 验证结果

- `npm test`：93 项全部通过，0 失败、0 跳过。
- `npm run build`：TypeScript 与 Vite 生产构建通过。
- `node scripts/ui-clarity-check.mjs <Playwright 模块路径>`：Edge 实际运行 cloud/local 两种服务，通过以下检查：
  - 首次阅读示例、只读协作说明、进入收费确认弹窗均没有创建任务，余额保持 500。
  - 实际上传 CSV，协作模式两次确认，创建一次任务，完成报告后结算 20 额度。
  - 完成后隐藏、重新登录/刷新后进度保留、帮助重开、持久关闭；同浏览器切换另一账号不共享完成标记。
  - AI 未开放、未配置 Key、剩余 19 额度三种状态；空任务状态；缺少数据集时加载示例。
  - 1450 / 1270 / 1050 / 800 / 600 / 390px 六种宽度：正文和辅助字号、横向溢出、指标数字裁切、文本色对比度。
  - 数据源、报告列表、Skill 能力库、额度页在 390px 下无页面横向溢出，正文至少 13px；额度提示确实使用 Info 图标。
  - 跳到主内容、帮助/模型设置/账号弹窗焦点陷阱；打印模式保留完整报告和示例标识、隐藏导航与清单。
  - 强制渲染异常后恢复界面，复制诊断不含注入的测试秘密；剪贴板不可用时可手动复制；浏览器禁用 localStorage 时仍可使用。
- `node scripts/model-settings-check.mjs <Playwright 模块路径>`：模型发现、选择和测试流程回归通过，3 次可控模型响应，0 页面异常，未调用真实收费模型。
- PostCSS 对原打印规则的语义比较通过；格式化前备份校验通过。`git diff --check` 通过。
- 已目视检查最终桌面、390px 示例报告、数据源与额度页截图。

| 文本 token | `--bg` 对比度 | `--paper` 对比度 |
| --- | ---: | ---: |
| `--muted` | 5.58:1 | 5.88:1 |
| `--faint` | 4.85:1 | 5.11:1 |

均满足普通小字 WCAG AA 的 4.5:1 要求。

浏览器验收结果及截图：`artifacts/ui-clarity-1792914357985/`；模型设置回归：`artifacts/model-settings-1792914388942/`。这些目录已忽略，不进入发布源码。

## 使用与验证边界

本机预览服务使用原 `data/cloud` 目录，地址为 `http://127.0.0.1:3002`。桌面客户端连接此地址后重新载入即可看到新界面。原服务已停止，重新启动后，会话内存中的模型 Key 如有丢失需重新填写。

本提示词内的实现和自动验证已完成。未进行真人“3 分钟完成”计时测试或物理打印验证；打印检查针对浏览器打印媒体样式。没有执行公网部署、GitHub 推送或重新生成安装包。
