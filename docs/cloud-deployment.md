# 云端账号服务部署

首次部署请先看 **[服务器部署与 HTTPS 从零教程](ubuntu-https-guide.md)**，包含 Ubuntu 24.04、Docker、域名、端口、证书、客户端和排错。本文保留为部署配置及数据范围参考。

这是管理员部署说明。用户安装桌面软件后，连接你部署的服务，注册和登录自己的账号。GitHub 提供下载；账号服务需要持续运行。本文配置为单实例 SQLite 版本，数据库放在持久化卷中。

## 先在本机验证

需要 Node.js 24。项目目录执行：

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run cloud
```

打开启动日志中的本机地址（默认 `http://127.0.0.1:3002`），注册两个不同用户名，分别上传自己的数据、创建报告、查看额度。桌面客户端可连接同一地址进行开发验收。本机地址只供当前电脑使用。

账号服务使用独立的账号与用户工作空间目录。设置 `DATAAGENT_DATA_DIR` 可以明确指定持久化位置；不要把用户数据放在源码仓库或容器临时文件系统里。

## 在服务器启动

准备能够运行 Docker Compose 的服务器、一个指向该服务器的域名，以及可访问的 80/443 端口。部署以下源码：

```bash
git clone https://github.com/lu-13-debug/DataAgent.git
cd DataAgent
cp .env.example .env
```

修改 `.env` 中的 `DATAAGENT_DOMAIN` 为实际域名，例如 `analysis.your-domain.com`。`DATAAGENT_MODEL_HOSTS` 默认包含 `api.deepseek.com,api.anthropic.com,api.openai.com`，开放三家的官方兼容接口。填写其他主机列表会覆盖默认值，只填精确主机名，英文逗号分隔，不含协议、路径、端口或通配符；显式设置为空可关闭 AI。API Key 由各用户在登录后填写，不写进这个文件。

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app caddy
```

Compose 只向外发布 Caddy 的 80/443 端口，分析服务端口留在内部网络。Caddy 根据域名自动申请 HTTPS 证书；证书申请需要 DNS 和公网端口均正确。`accounts_data` 保存账号、报告、上传数据与额度，不随容器重建丢失。

部署完成后访问 `https://你的域名/api/runtime`，应包含 `serviceName: "DataAgent"`、`mode: "cloud"`、`authRequired: true`。随后用浏览器或桌面客户端实际注册和登录，检查上传数据及报告流程。

当前工作环境没有 Docker 引擎，容器配置随源码提供；本机 Node 服务及打包客户端的实际验收结果记录在版本说明中，不能据此声称服务器或 Docker 已在公网部署成功。

## 分发桌面客户端

直接使用默认安装包时，首次打开输入你部署好的 HTTPS 服务地址。地址在用户电脑本地保存，账号与数据仍在该服务中。

要让普通用户安装后直接进入你的登录页，在构建安装包前修改 `build/cloud-config.json`：

```json
{ "serverUrl": "https://analysis.your-domain.com" }
```

然后执行 `npm.cmd run desktop:build`，分发生成的 EXE。此 JSON 只保存服务地址，不能放 API Key、密码或会话令牌。可通过桌面菜单切换服务，原服务会话将清理。

云端版本需要联网；未运行服务时，客户端会提示连接失败并允许重新配置。旧 1.0.0 安装包为本地单用户版，不会自动获得云端账号功能。

## 账号与数据

- 用户名 3–32 个英文字母、数字或下划线，不区分大小写；显示名称支持中文。
- 密码 10–128 字符，经随机盐 scrypt 散列保存；没有可供管理员读取的明文密码。
- 注册成功自动登录。退出撤销当前会话，修改密码撤销全部会话。首版未接入邮箱验证码和自助密码找回。
- 每个用户有独立的上传数据、报告、非敏感模型配置和 500 初始试用额度，单次任务冻结 20。额度由服务端计算，失败或取消释放。
- API Key 在云端当前登录会话的内存中使用；退出、服务重启后需重新填写。任务在执行期间会持有发起时的凭据快照。
- 上传的完整分析数据保存在你运营的服务器；只有业务背景和聚合指标发送到用户选定的模型供应商。用户应了解所连接服务的运营方。
- 真实支付、邮箱找回、多副本部署与组织团队权限不在本版范围内。

## 更新与备份

更新前先备份持久化数据，再拉取源码与重建服务。升级会短暂中断运行中的分析；服务恢复后，未完成任务会被标记中断并释放冻结额度，已完成数据保留。

```bash
mkdir -p backups
docker compose stop app
docker compose run --rm --no-deps --user 0 --entrypoint tar \
  -v "$PWD/backups:/backup" app \
  -czf /backup/dataagent-backup.tgz -C /app/data .
docker compose start app
```

备份时停止服务以避免 SQLite/WAL 文件处于不同写入时刻。备份包含用户数据、账号密码散列与会话散列，应放在受访问控制的存储中；API Key 不在备份内。

```bash
git pull --ff-only
docker compose up -d --build
```

不要使用 `docker compose down -v` 更新服务，因为 `-v` 会删除持久化卷。首次运营时先小范围验证账号、跨账号访问、备份恢复和模型白名单，再扩大用户数量。

参考：[Docker Node.js 指南](https://docs.docker.com/guides/nodejs/)、[Caddy HTTPS](https://caddyserver.com/docs/quick-starts/https)、[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[OWASP 会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。

## 只读分享与日志配置

云端服务支持为已完成报告生成有限期、可撤销的只读快照。链接中的令牌位于 `#` 片段；公开读取通过同源 POST 请求体传递令牌。请确保 Caddy、反向代理、APM、错误监控及调试中间件不记录请求体、分享令牌或完整带片段的浏览器地址；分享与公开 API 响应使用 `no-store` 和 `no-referrer`。不要添加会捕获请求体的日志插件。

隐藏收入时，公开快照仅保留安全字段，不提供玩家明细或数据下载；它不包含原报告中的自由文本和 AI 叙述。分享数据和去重计数保存在账号数据库中，因此也属于上述备份范围。访问和注册计数基于随机访客标识去重，不代表自然人数量；到期超过 30 天的记录会按服务策略清理。升级前仍需检查正在运行的任务并备份数据，服务重启会清除会话中的模型 Key。
