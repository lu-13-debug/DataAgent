# DataAgent

面向游戏研发与运营团队的数据分析软件。Windows 桌面客户端连接可部署的云端账号服务，用户注册登录后使用自己的数据、报告与额度。支持协作/自动模式、CSV 与 Excel、游戏指标计算、可选 AI 辅助解读、执行动态和报告导出。

当前账号版：**1.1.0**。源码：[lu-13-debug/DataAgent](https://github.com/lu-13-debug/DataAgent)。1.0.0 为原本地单用户版，发布历史保留。

## 账号服务与部署

账号版需要一个持续运行的服务。用户可注册、登录、退出和修改密码；同一服务内的每个账号拥有独立的数据、报告、非敏感模型配置和试用额度。用户名不区分大小写，显示名称支持中文。

先完成本机验证：

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run cloud
```

打开日志中的地址（默认 `http://127.0.0.1:3002`），或让桌面客户端连接它。对外服务请部署到有域名与 HTTPS 的服务器，详见 **[云端部署说明](docs/cloud-deployment.md)**。提供 Dockerfile、Compose、Caddy 与持久化/备份配置；当前代码交付不代表已在公网部署账号服务。

云端密码使用随机盐散列，登录凭据使用 HttpOnly Cookie。API Key 只保留在云端当前登录会话的内存中，退出或服务重启后需重新填写；上传数据和报告保存在所连接的服务器。每次云端模型请求仅向用户指定且管理员已允许的供应商发送业务背景与聚合指标。

## Windows 桌面版

从 [发布页](https://github.com/lu-13-debug/DataAgent/releases) 下载账号版 `DataAgent-Setup-1.1.0-x64.exe`，或从源码构建到 `release/`。支持 Windows 10/11 的 x64 系统；双击安装，可选择目录，安装后从桌面或开始菜单打开 **DataAgent**。桌面版内置运行时，无需安装 Node.js。

首次打开连接管理员提供的 HTTPS 服务地址，随后注册或登录。可在打包前通过 `build/cloud-config.json` 预置服务地址。云端工作台需要联网，菜单支持切换服务并清理原服务会话。旧版 `%APPDATA%\DataAgent\storage` 中的本地数据保留，不会自动归到任何云端账号。

从源码运行和打包桌面版：

```powershell
npm.cmd install
npm.cmd run desktop:dev
npm.cmd run desktop:build
```

`desktop:build` 生成完整 NSIS 安装包，安装本身不需要另行下载应用资源；账号、数据分析和模型调用需要连接云端服务。当前安装包未配置商业代码签名。

## 原单用户本地入口（开发与离线计算）

需要 Node.js 24 或更高版本。这个入口不提供注册登录，适合本机开发与原版数据查看，不应直接对外提供多用户访问：

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
- 右侧展示真实节点状态、调用能力、结果摘要和执行记录。
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

- 云端 API Key 只保留在当前登录会话的服务端内存，不写入数据库、浏览器存储或日志；退出或重启后需要重新填写。原单用户入口的 Key 保留在本机服务进程内存。
- 系统向用户指定的供应商发送分析目标、主动提供的业务背景和聚合指标，不发送原始玩家 ID 明细。
- 模型费用由供应商从你的 API 账户扣除，与服务额度独立。
- 模型失败会使任务明确失败并释放服务额度，不会静默换供应商或冒充 AI 成功。
- AI 解读属于辅助观察与待验证建议。代码核验的是计算指标和数值边界，无法保证所有自然语言判断正确，不据时间相关性认定因果。

## 额度、持久化与部署边界

云端账号版支持注册登录与个人空间隔离，尚未接入真实支付、邮箱找回或组织权限。每个新账号初始 500 试用额度，每次任务冻结 20；完成结算，失败/取消释放。示例历史报告不收费。账本由服务端持久化，客户端不能上报扣费结果。

云端账号库与各用户工作空间分开保存；可使用 `DATAAGENT_DATA_DIR` 指定持久化目录，容器中为 `/app/data`。原单用户入口仍使用根目录 `data/`。服务重启时，未完成任务标记中断并释放额度，已完成报告保留。不要将运行数据提交到 GitHub。

账号服务按单实例 SQLite 部署，内置认证、会话、同源检查与用户隔离；生产需配置 HTTPS 的 `PUBLIC_URL` 和可信模型主机白名单，并按部署说明备份数据。不要将原单用户入口暴露公网，也不要把本版作为多副本集群运行。正式收费仍需另外接入支付和运营流程。

## 验证

```powershell
npm.cmd test
npm.cmd run build
```

覆盖指标手算、订单去重、留存成熟度、CSV/XLSX、额度事务、协作确认、防重、取消/重启、模型成功/失败和凭据保护。真实付费供应商未使用用户 Key 联测；模型集成使用可控响应验证。

浏览器验收脚本位于 `scripts/browser-check.mjs`，需本机 Edge 和 Playwright。可将 Playwright 模块绝对路径作为第一个参数传入，不影响日常启动。

1.1.0 已通过 65 项自动化测试、生产构建、浏览器双账号验收，以及真正打包后的 `win-unpacked/DataAgent.exe` 注册、双账号隔离、上传 CSV、协作/自动分析、报告和切换服务验收。规格与质量审查通过。Docker 引擎和公网服务器在当前环境不可用，容器部署与公网访问未实测。可选复验命令：

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
