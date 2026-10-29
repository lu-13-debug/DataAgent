# DataAgent 服务器部署与 HTTPS 从零教程

本教程使用 **全新的 Ubuntu 24.04 LTS 服务器、Docker Compose 和 Caddy**，适用于 1.1.0 账号版。最终获得类似 `https://analysis.example.com` 的地址，用户在 Windows 软件里连接它，就能注册和登录。

请替换文中的域名、公网 IP 和 SSH 用户名。**第 2–7 步在服务器执行，第 8 步在 Windows 客户端操作。** GitHub 负责分发软件，账号服务运行在你的服务器上。

## 1. 准备服务器和域名

准备有公网 IPv4 的 Ubuntu 24.04 LTS 服务器，以及能管理 DNS 的域名。小范围试用可从 2 核、4GB 内存起步；这是本项目的起步估计，并发和磁盘容量需要按上传数据实测。已有网站的服务器应先规划端口共存。

云服务器安全组/防火墙中设置：

| 协议/端口 | 用途 | 来源 |
| --- | --- | --- |
| TCP 22，或实际 SSH 端口 | 管理服务器 | 你的管理 IP |
| TCP 80 | 证书验证、HTTP 跳转 | 公网 |
| TCP 443 | HTTPS | 公网 |
| UDP 443，可选 | HTTP/3 | 公网 |

**无需公开 3002 或 5173**，账号服务位于容器内部网络。Docker 的端口发布可能绕过 UFW 等规则，见 [官方说明](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations)；使用云安全组和实际端口映射共同控制入口。

## 2. 从 Windows 登录服务器

在 Windows PowerShell 执行厂商提供的 SSH 命令，例如：

```powershell
ssh ubuntu@服务器公网IP
```

用户名也可能是 root，使用密钥时按厂商控制台指引连接。登录后执行 `sudo -i` 切到 root；已经是 root 时省略。以下 Linux 命令不要直接粘贴到 Windows PowerShell。

## 3. 安装 Docker Compose

已有 Docker 时先检查 `docker version`、`docker compose version`，正常则跳过。全新 Ubuntu 按官方软件源安装：

```bash
apt-get update
apt-get install -y ca-certificates curl git dnsutils nano
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker version
docker compose version
```

已有软件包冲突时按 [Docker Ubuntu 安装文档](https://docs.docker.com/engine/install/ubuntu/) 处理，本文不自动卸载已有服务。

## 4. 解析域名

假设你拥有 `example.com`，到 DNS 管理页添加：

| 类型 | 主机记录 | 记录值 |
| --- | --- | --- |
| A | analysis | 服务器公网 IPv4 |

得到 `analysis.example.com`。根域名的主机记录通常是 `@`。首次先使用直接 DNS 解析，直连 HTTPS 正常后再增加 CDN 或其他代理。

```bash
dig +short A analysis.example.com
dig +short AAAA analysis.example.com
```

A 记录应指向你的服务器。只有配置好 IPv6 才保留 AAAA，不要指向其他旧服务器。等待解析生效后继续。

## 5. 下载项目并填写配置

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/lu-13-debug/DataAgent.git
cd DataAgent
cp .env.example .env
nano .env
```

已克隆时在原目录执行 `git pull --ff-only`，保留已有 `.env`，不要再次复制模板覆盖它。编辑内容，例如：

```dotenv
DATAAGENT_DOMAIN=analysis.example.com
DATAAGENT_MODEL_HOSTS=api.deepseek.com,api.anthropic.com,api.openai.com
```

域名不加协议、端口或路径。模型白名单默认开放 DeepSeek、Claude（Anthropic）、OpenAI 三家的官方 HTTPS 主机；配置此变量会覆盖默认列表，多个用英文逗号分隔，不填 URL 或通配符。供应商基础地址和填写方法见 [模型与 Key](../README.md#模型与-key)。

只验证注册和确定性分析时，可以显式设置 `DATAAGENT_MODEL_HOSTS=` 关闭 AI。**用户 Key 在登录后的软件设置中填写，不写进 `.env`。** 在 nano 按 Ctrl+O、回车保存，Ctrl+X 退出。

Compose 会同时给 Caddy 和应用设置该域名，并自动生成 `PUBLIC_URL=https://你的域名`。

## 6. 启动并启用 HTTPS

在 `/opt/DataAgent` 执行：

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app caddy
```

首次会下载镜像、安装依赖和编译。等待 app healthy、caddy 正常运行。仓库的 Caddy 配置已经准备好：

```caddyfile
{$DATAAGENT_DOMAIN} {
    encode zstd gzip
    reverse_proxy app:3002
}
```

域名解析正确且公网 80/443 可达后，Caddy 会自动申请和管理 HTTPS 证书，证书持久化保存并由 Caddy 管理续期，见 [官方 HTTPS 教程](https://caddyserver.com/docs/quick-starts/https)。无需手工上传证书。

修改 `.env` 后运行 `docker compose up -d` 按新环境重建容器；只运行 `docker compose restart` 不会更新环境变量。

## 7. 检查部署结果

替换为自己的域名：

```bash
curl -fsS https://analysis.example.com/api/runtime
curl -sS -o /dev/null -w '%{http_code}\n' https://analysis.example.com/api/bootstrap
```

第一个应返回包含 `mode: cloud`、`authRequired: true`、`serviceName: DataAgent`、`version: 1.1.0` 的 JSON。第二个未登录时应该为 **401**，表示业务接口受登录保护。

再用浏览器打开该 HTTPS 地址，创建账号、上传数据、运行分析；退出后创建第二个账号，确认数据和额度独立。证书、注册和登录实际正常后，才算这台服务器部署成功。

## 8. 让 Windows 软件连接

用户从 [1.1.0 发布页](https://github.com/lu-13-debug/DataAgent/releases/tag/v1.1.0) 安装 EXE，首次填写你的服务根地址：

```text
https://analysis.example.com
```

不加 `/api` 或 `:3002`，不要使用服务器 IP 或用户电脑自己的 `127.0.0.1`。连接后即可注册或登录，同一服务的账号可在不同电脑继续使用。

启用 AI 时，管理员先开放模型主机；用户再填写兼容基础地址、供应商当前支持的模型名称和自己的 Key，测试连接后分析。模型费用由用户的 API 账户承担。

想让安装后直接进入你的登录页，在 **Windows 构建电脑** 修改 `build/cloud-config.json`，然后重打安装包：

```json
{ "serverUrl": "https://analysis.example.com" }
```

```powershell
npm.cmd ci
npm.cmd run desktop:build
```

分发 `release/` 的 EXE。普通用户无需 Node.js 或 Docker；配置文件不能放密码、Key 或令牌。

## 9. 排错与后续更新

| 现象 | 检查方法 |
| --- | --- |
| 域名无法访问 | 核对 A/AAAA、安全组、公网 IP、`docker compose ps`。 |
| 证书申请失败 | 看 `docker compose logs --tail=200 caddy`，核对 DNS、80/443 与旧 AAAA。 |
| 端口占用 | 用 `ss -lntp` 查看；先规划与已有网站共存，不要盲目停止已有业务。 |
| HTTPS 返回 502 | 看 `docker compose logs --tail=200 app`，确认 app healthy。 |
| app unhealthy | 检查域名格式、日志、磁盘和数据卷权限，容器默认非 root。 |
| 地址无效或写请求 403 | 浏览器/软件域名必须与 `.env` 一致，改域名后重建 app/caddy。 |
| AI 未开放 | 检查模型主机白名单，HTTPS 基础地址的主机须精确匹配。 |
| 模型失败 | 核对基础地址、模型权限、Key、兼容格式和服务器出网。 |
| 下载超时 | 检查出网、DNS、代理，不要关闭 TLS 校验。 |
| 没有注册页 | 使用 1.1.0 并连接正确服务；1.0.0 是原单用户版。 |

换域名时先完成新 DNS，再改 `.env`，在原目录运行：

```bash
docker compose up -d --force-recreate app caddy
```

客户端改地址后重新登录。保留原数据卷时，账号、额度和报告不会重置。更新和备份步骤见 [部署参考](cloud-deployment.md#更新与备份)；不要使用 `docker compose down -v` 更新，它会删除数据卷。

本版为单实例 SQLite 服务，不含真实支付、邮箱验证、自助密码找回或组织权限。当前环境已验证 Windows/Node 和实际 EXE 的业务流程，没有 Docker 引擎，未在你的公网服务器实测容器、DNS 或证书签发。

参考：[Docker 安装](https://docs.docker.com/engine/install/ubuntu/)、[Compose 环境变量](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)、[Caddy HTTPS](https://caddyserver.com/docs/quick-starts/https)。
