# DataAgent

面向游戏研发与运营团队的本地数据分析工作台。支持协作/自动模式、CSV 与 Excel、游戏指标计算、可选 AI 辅助解读、执行动态和报告导出。

当前版本：**1.0.0**。源码：[lu-13-debug/DataAgent](https://github.com/lu-13-debug/DataAgent)。

## Windows 桌面版

从 [v1.0.0 发布页](https://github.com/lu-13-debug/DataAgent/releases/tag/v1.0.0) 下载 `DataAgent-Setup-1.0.0-x64.exe`，或从源码构建到 `release/`。支持 Windows 10/11 的 x64 系统；双击安装，可选择目录，安装后从桌面或开始菜单打开 **DataAgent**。桌面版内置运行时，无需安装 Node.js，也无需手动启动服务或浏览器。

每次打开应用会自动启动本机分析服务；关闭应用后服务退出。桌面版数据库保存在 `%APPDATA%\DataAgent\storage`，与源码开发数据分开；菜单「帮助 → 打开数据目录」可查看。API Key 重启后仍需重新输入，避免落盘。

从源码运行和打包桌面版：

```powershell
npm.cmd install
npm.cmd run desktop:dev
npm.cmd run desktop:build
```

`desktop:build` 生成完整离线 NSIS 安装包，安装本身不需要另行下载应用资源。使用 AI 模型时仍需网络和用户自己的有效 Key。当前安装包未配置商业代码签名。

## 启动

需要 Node.js 24 或更高版本。在本目录执行：

```powershell
npm.cmd install
npm.cmd run build
npm.cmd start
```

打开 <http://127.0.0.1:3001>。Windows 也可以双击根目录 `启动 DataAgent.cmd`，它会检查依赖、构建并启动服务。

开发模式：

```powershell
npm.cmd run dev
```

前端 <http://127.0.0.1:5173>，后端 <http://127.0.0.1:3001>。Ctrl+C 停止。

## 两种工作方式

- **协作模式**：在分析计划和报告生成前暂停。可补充业务背景，确认后继续；确认请求带步骤标识，防止延迟重试误批准下一阶段。
- **自动模式**：确认任务范围后，运行既定分析流程，产出报告。
- 右侧展示真实节点状态、调用能力、结果摘要和执行记录。显示的是工作进展，不是模型内部思考。
- 执行中可停止任务；已冻结的服务额度会释放。完整报告支持 Markdown 下载与打印/保存 PDF。

## 数据

首次运行生成一份清楚标注的演示数据和计算报告，方便无 Key 体验。演示数据不代表真实业务。

支持 UTF-8 CSV、XLSX；最多 3 个文件，合计不超过 20MB、200000 行。Excel 可使用多个工作表，或按标准表分别上传 CSV。应用内可下载模板。

| 标准表 | 字段 |
| --- | --- |
| users | user_id, registered_at, channel（可选） |
| activity | user_id, event_time |
| payments | order_id, user_id, paid_at, amount, currency, status |

支持常见中文别名。无时区时间和 Excel 原生日期单元格按 Asia/Shanghai 处理；显式 ISO 时区保持绝对时间语义。建议使用 `2026-10-01T10:00:00+08:00`。玩家 ID 应是同一口径的账号标识。金额非负、最多两位小数；币种使用 CNY/USD 等代码；支付状态使用 success/paid/completed 等成功状态。冲突订单、无效时间与混合币种会明确拒绝。

只上传部分表也可分析；缺表或观察窗口不足的指标显示无数据，不推断留存或收入。不同数据表的覆盖差异会进入质量提示。历史文件的覆盖边界依据首末事件推断，系统无法完全区分零事件日和漏传日，正式决策前应确认采集完整性。当前自然日不进入完整日指标。

## 模型与 Key

打开「模型与 API 设置」，填写供应商名称、Chat Completions 兼容接口基础地址、模型名和 Key。保存后，新分析可启用 AI。测试连接会产生一次少量 Token 调用。

- API Key 只保留在本次服务进程内存，不写入数据库、浏览器存储或日志；重启后需要重新填写。
- 系统向用户指定的供应商发送分析目标、主动提供的业务背景和聚合指标，不发送原始玩家 ID 明细。
- 模型费用由供应商从你的 API 账户扣除，与服务额度独立。
- 模型失败会使任务明确失败并释放服务额度，不会静默换供应商或冒充 AI 成功。
- AI 解读属于辅助观察与待验证建议。代码核验的是计算指标和数值边界，无法保证所有自然语言判断正确，不据时间相关性认定因果。

## 额度、持久化与部署边界

本版为 **localhost 单用户软件**，无登录、组织隔离和真实支付。初始 500 试用额度，每次任务冻结 20；完成结算，失败/取消释放。示例历史报告不收费。额度流水持久化并保证重复结算幂等。

数据、任务、报告与账本保存在根目录 `data/` 的 SQLite 数据库中。可使用 `DATAAGENT_DATA_DIR` 指定目录，`PORT` 指定后端端口。`data/` 已被 Git 忽略。关闭再启动服务时，未完成任务标记中断并释放额度，已完成报告保留。

服务默认只监听 `127.0.0.1`，有本地 Host/Origin 检查。不要直接以当前版本作为公开多租户 SaaS 部署；对外服务需要另加身份认证、租户权限、密钥管理、隔离执行、支付与正式运维。

## 验证

```powershell
npm.cmd test
npm.cmd run build
```

覆盖指标手算、订单去重、留存成熟度、CSV/XLSX、额度事务、协作确认、防重、取消/重启、模型成功/失败和凭据保护。真实付费供应商未使用用户 Key 联测；模型集成使用可控响应验证。

浏览器验收脚本位于 `scripts/browser-check.mjs`，需本机 Edge 和 Playwright。可将 Playwright 模块绝对路径作为第一个参数传入，不影响日常启动。

本次交付已通过 30 项自动化测试、生产构建、浏览器完整流程，以及真正打包后程序的启动、协作/自动分析、报告与额度保存验收。未在当前系统执行安装；安装包由 NSIS 编译，应用功能通过其中同一份 `win-unpacked/DataAgent.exe` 验收。可选复验命令：

```powershell
node scripts/desktop-smoke.mjs release/win-unpacked/DataAgent.exe
node scripts/desktop-check.mjs <Playwright模块路径> release/win-unpacked/DataAgent.exe
```

安装包的 SHA256 位于 `release/SHA256SUMS.txt`。首版提供 8 个内置 Skill 节点，按预定义工作流执行；新增领域、节点或分支可在源码注册，当前没有可视化工作流编辑器或任意第三方 Skill 导入。

## 代码结构

```text
src/                  React 页面、报告、工作动态与弹窗
server/               数据解析、指标计算、工作流、账本、模型网关与测试
scripts/              开发启动与浏览器验收
desktop/              Windows 桌面主进程与运行验收
release/              Windows 安装包与校验文件（构建生成）
docs/api-contract.md  前后端接口
docs/superpowers/     设计与实施记录
data/                 本地运行数据（自动生成，不进入版本控制）
```

新增领域时，扩展领域注册信息、数据规范、指标实现和 Skill 工作流。当前仅开放游戏运营，其他领域入口明确标注尚未开放。
