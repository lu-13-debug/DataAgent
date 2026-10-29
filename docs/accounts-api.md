# 账号版接口契约

所有业务接口仍为同源 `/api`。云端通过 HttpOnly Cookie `da_session` 认证，前端不保存令牌。会话失效时业务 API 返回 401。

```ts
type User = { id: string; username: string; displayName: string; createdAt: string };
type Runtime = { mode: 'local' | 'cloud'; authRequired: boolean; serviceName: 'DataAgent'; version: string; modelHosts?: string[] };
```

- `GET /api/runtime`：公开返回 Runtime。旧单用户服务返回 mode=local/authRequired=false。桌面连接验证只接受 mode=cloud/authRequired=true/serviceName=DataAgent。
- `GET /api/auth/session`：公开返回 `{ user: User | null }`，无效会话返回 null，不抛 401。
- `POST /api/auth/register`：`{ username, displayName, password }`，201 `{ user }` 并自动登录。
- `POST /api/auth/login`：`{ username, password }`，200 `{ user }`，失败 401。
- `POST /api/auth/logout`：空对象，200 `{ ok: true }`，撤销当前会话并清 Cookie。
- `POST /api/auth/change-password`：`{ currentPassword, newPassword }`，200 `{ ok: true }`；撤销全部会话，前端回登录页。

其余 bootstrap、dataset、task、wallet、settings 接口结构沿用 docs/api-contract.md；服务器从登录态选择工作空间，拒绝其他账号的资源 ID。模型 Key 按会话隔离，非敏感模型配置按账号保存。新账号初始试用额度 500。

生产服务环境变量：`PUBLIC_URL`（HTTPS 根域名）、`PORT`（默认3002）、`HOST`（默认127.0.0.1）、`DATAAGENT_DATA_DIR`、`TRUST_PROXY`（默认关闭，反向代理设1）、`DATAAGENT_MODEL_HOSTS`（逗号分隔精确 HTTPS 主机名，默认 `api.deepseek.com,api.anthropic.com,api.openai.com`；显式空值关闭 AI）。本机开发允许环回 HTTP，生产拒绝环回以外的 HTTP 地址。

入口 `server/cloud-index.js`，创建器 `server/cloud-app.js` 的 `createCloudApp(options={})`，至少支持 dataDir/distDir/publicUrl/production/sessionTtlMs/now/modelHosts/fetchImpl/modelTimeoutMs 供独立测试。app.locals.close() 关闭全部工作流和数据库。

桌面默认服务地址由 `build/cloud-config.json` 中 `{ "serverUrl": "" }` 提供；用户自行填写的地址只保存在自己的 userData/connection.json。客户端只接受根地址，不接受含账号密码、查询或片段的 URL。前端云端登录表单通过 GET runtime 自动识别服务模式。
