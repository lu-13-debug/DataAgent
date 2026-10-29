import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { shareSnapshot } from './report-sharing.js';
import { DEFAULT_MODEL_HOSTS } from './gateway.js';
import { TASK_CAPABILITIES } from './task-monitor.js';
import { Accounts, PasswordHasher, AuthRateLimiter, authError, usernameValue, passwordValue, publicUser } from './accounts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
function serviceUrl(value, production) {
  let url; try { url = new URL(value); } catch { throw new Error('PUBLIC_URL 必须是有效服务根地址'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('PUBLIC_URL 必须是无凭据、查询和片段的根地址');
  if (production && url.protocol !== 'https:') throw new Error('生产环境 PUBLIC_URL 必须使用 HTTPS');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url.hostname))) throw new Error('服务地址必须使用 HTTPS；本机开发仅允许环回 HTTP');
  return url;
}
function modelPolicy(hosts, { production, allowLocalModelHttp, fetchImpl }) {
  const allowed = [...new Set(hosts.map(x => String(x).trim().toLowerCase()).filter(Boolean))];
  for (const host of allowed) {
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.includes('..') || loopback(host) || /^\d+(?:\.\d+){3}$/.test(host)) throw new Error('DATAAGENT_MODEL_HOSTS 必须为精确 HTTPS 主机名');
  }
  const assert = settings => {
    const url = new URL(settings.baseUrl);
    const localTest = !production && allowLocalModelHttp === true && typeof fetchImpl === 'function' && url.protocol === 'http:' && loopback(url.hostname);
    if (localTest) return;
    if (url.protocol !== 'https:' || url.port || !allowed.includes(url.hostname.toLowerCase())) throw authError('模型服务未列入管理员配置的 HTTPS 主机白名单，无法发起 AI 请求');
  };
  return { allowed, assert };
}
function cookieToken(req) {
  const values = String(req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith('da_session='));
  return values.length === 1 ? values[0].slice('da_session='.length) : '';
}

export function createCloudApp(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const configuredUrl = options.publicUrl || process.env.PUBLIC_URL;
  if (production && !configuredUrl) throw new Error('生产环境必须配置 HTTPS PUBLIC_URL');
  // Development listeners may use an OS-selected loopback port.
  const publicUrl = configuredUrl ? serviceUrl(configuredUrl, production) : null;
  const hosts = options.modelHosts ?? (process.env.DATAAGENT_MODEL_HOSTS === undefined ? DEFAULT_MODEL_HOSTS : process.env.DATAAGENT_MODEL_HOSTS.split(','));
  const policy = modelPolicy(hosts, { ...options, production });
  const dataDir = path.resolve(options.dataDir || process.env.DATAAGENT_DATA_DIR || path.join(root, 'data', 'cloud'));
  const now = options.now || Date.now;
  const accounts = new Accounts(dataDir, { now, sessionTtlMs: options.sessionTtlMs });
  const hasher = new PasswordHasher({ maxConcurrent: options.maxKdfConcurrent || 2, maxQueue: options.maxKdfQueue ?? 16 });
  const limiter = new AuthRateLimiter(options.authRateLimit, now);
  const app = express(); app.disable('x-powered-by');
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === '1';
  app.set('trust proxy', trustProxy ? 1 : false);
  const workspaces = new Map(); const maxWorkspaces = options.maxWorkspaces || 32; const idleMs = options.workspaceIdleMs ?? 15 * 60 * 1000;
  let inFlight = 0; let closed = false;
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: production || publicUrl?.protocol === 'https:', path: '/', maxAge: accounts.sessionTtlMs };
  const sendSession = (res, user, status = 200) => { const token = accounts.createSession(user.id); res.cookie('da_session', token, cookieOptions); return res.status(status).json({ user: publicUser(user) }); };
  const requireSession = req => { const session = accounts.session(cookieToken(req)); if (!session) throw authError('登录已失效，请重新登录', 401); return session; };
  const idle = workspace => workspace.refs === 0 && !workspace.app.locals.isBusy();
  function evict(workspace) { workspace.app.locals.close(); workspaces.delete(workspace.userId); }
  function cleanupWorkspaces() { accounts.prune(); accounts.pruneShares(); for (const workspace of workspaces.values()) if (idle(workspace) && now() - workspace.lastUsed >= idleMs) evict(workspace); }
  function workspaceFor(userId) {
    let workspace = workspaces.get(userId);
    if (workspace) return workspace;
    if (workspaces.size >= maxWorkspaces) {
      const candidates = [...workspaces.values()].filter(idle).sort((a, b) => a.lastUsed - b.lastUsed);
      if (!candidates.length) throw authError('服务工作空间已满，请稍后再试', 503);
      evict(candidates[0]);
    }
    const child = createApp({ dataDir: path.join(dataDir, 'users', userId), serveStatic: false, cloud: true, networkGuard: false, maxDatasets: 20, maxConcurrentTasks: 2, maxAsyncRequests: options.maxWorkspaceRequests || 8, fetchImpl: options.fetchImpl, modelTimeoutMs: options.modelTimeoutMs,
      maxTaskEventConnections: options.maxTaskEventConnections, taskHeartbeatMs: options.taskHeartbeatMs,
      maxReportExplorations: options.maxReportExplorations, reportExploreWorkerFactory: options.reportExploreWorkerFactory, reportExploreTimeoutMs: options.reportExploreTimeoutMs,
      isSessionValid: req => Boolean(accounts.session(cookieToken(req))),
      getTaskEventOrigin: (_req, res) => res.locals.cloudRequestOrigin,
      onTaskEventConnect: (_req, res) => { res.locals.releaseCloudRequest?.(); res.locals.releaseWorkspaceRequest?.(); },
      getKey: (req, baseUrl) => accounts.getKey(req.cloudSession.hash, baseUrl), setKey: (req, key, baseUrl) => accounts.setKey(req.cloudSession.hash, key, baseUrl), assertModelSettings: policy.assert });
    workspace = { userId, app: child, refs: 0, lastUsed: now() }; workspaces.set(userId, workspace); return workspace;
  }
  app.locals.cleanupWorkspaces = cleanupWorkspaces;
  const timer = setInterval(cleanupWorkspaces, Math.min(idleMs || 1, 60000)); timer.unref();
  app.locals.close = () => { if (closed) return; closed = true; clearInterval(timer); for (const workspace of workspaces.values()) workspace.app.locals.close(); workspaces.clear(); accounts.close(); };

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.path.startsWith('/api') || req.path === '/share' || req.path.startsWith('/share/')) res.setHeader('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/public/shares/') || req.path === '/share' || req.path.startsWith('/share/')) res.setHeader('Referrer-Policy', 'no-referrer');
    // Ignore forwarded Host. Only the deployment's configured public Host is accepted.
    const host = String(req.get('host') || '').toLowerCase();
    let requestUrl;
    try { requestUrl = publicUrl || serviceUrl(`http://${host}`, false); } catch { return res.status(403).json({ error: '请求服务地址无效' }); }
    if (host !== requestUrl.host.toLowerCase() || (!publicUrl && !loopback(requestUrl.hostname))) return res.status(403).json({ error: '请求服务地址无效' });
    res.locals.cloudRequestOrigin = requestUrl.origin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if ((origin !== undefined && origin !== requestUrl.origin) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: '已拒绝跨站写入请求' });
    }
    if (inFlight >= (options.maxRequests || 128)) return res.status(503).json({ error: '服务繁忙，请稍后重试' });
    inFlight++;
    let released = false; const release = () => { if (!released) { released = true; inFlight--; } }; res.locals.releaseCloudRequest = release; res.once('finish', release); res.once('close', release); next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/runtime', (_req, res) => res.json({ mode: 'cloud', authRequired: true, serviceName: 'DataAgent', version: '1.1.0', modelHosts: policy.allowed, capabilities: { ...TASK_CAPABILITIES, reportSharing: true } }));
  app.get('/api/auth/session', (req, res) => { const session = accounts.session(cookieToken(req)); res.json({ user: session?.user || null }); });
  const rateLimit = req => { const name = typeof req.body?.username === 'string' ? req.body.username.toLowerCase().slice(0, 128) : ''; limiter.consume(req.ip, name); };
  app.post('/api/auth/register', async (req, res) => {
    rateLimit(req); const username = usernameValue(req.body?.username); const password = passwordValue(req.body?.password);
    const displayName = req.body?.displayName;
    if (typeof displayName !== 'string' || !displayName.trim() || [...displayName.trim()].length > 40) throw authError('显示名称须为 1–40 个字符');
    const hash = await hasher.hash(password); const user = accounts.register(username, displayName.trim(), hash, { shareToken: req.body?.shareToken, visitorToken: req.body?.visitorToken }); sendSession(res, user, 201);
  });
  app.post('/api/auth/login', async (req, res) => {
    rateLimit(req);
    let username, password;
    try { username = usernameValue(req.body?.username); password = passwordValue(req.body?.password); } catch { throw authError('用户名或密码错误', 401); }
    const user = accounts.userByName(username);
    if (!await hasher.verify(password, user?.password_hash)) throw authError('用户名或密码错误', 401);
    // A password change during the asynchronous KDF must not create a stale session.
    if (accounts.userByName(username)?.password_hash !== user.password_hash) throw authError('用户名或密码错误', 401);
    sendSession(res, user);
  });
  app.post('/api/auth/logout', (req, res) => {
    const session = accounts.session(cookieToken(req)); if (session) accounts.revoke(session.hash);
    res.clearCookie('da_session', { ...cookieOptions, maxAge: undefined }); res.json({ ok: true });
  });
  app.post('/api/auth/change-password', async (req, res) => {
    const session = requireSession(req); limiter.consume(req.ip, session.user.username);
    const next = passwordValue(req.body?.newPassword); const current = req.body?.currentPassword;
    if (typeof current !== 'string' || current.length > 128 || !await hasher.verify(current, session.passwordHash)) throw authError('当前密码错误', 401);
    const hash = await hasher.hash(next);
    const latest = accounts.session(cookieToken(req));
    if (!latest || latest.passwordHash !== session.passwordHash) throw authError('登录已失效，请重新登录', 401);
    accounts.changePassword(session.user.id, hash); res.clearCookie('da_session', { ...cookieOptions, maxAge: undefined }); res.json({ ok: true });
  });
  // Short-lived in-memory rate limiting; addresses are never persisted or included in reports.
  const shareLimiter = new AuthRateLimiter(options.shareRateLimit || { maxIp: 120, maxUsername: 10000, windowMs: 60000, maxEntries: 10000 }, now);
  const publicShare = req => {
    shareLimiter.consume(req.ip, 'share-public');
    const share = accounts.validShare(req.body?.token);
    if (!share) throw authError('分享不可用', 404);
    return share;
  };
  app.post('/api/public/shares/read', (req, res) => { const share = publicShare(req); res.json({ report: JSON.parse(share.snapshot) }); });
  app.post('/api/public/shares/visit', (req, res) => { const share = publicShare(req); accounts.visitShare(share, req.body?.visitorToken); res.json({ ok:true }); });
  app.post('/api/tasks/:id/shares', (req, res) => {
    const session = requireSession(req); const workspace = workspaceFor(session.user.id);
    let task; try { task = workspace.app.locals.store.get('task', req.params.id); } catch { throw authError('任务不存在', 404); }
    if (!task) throw authError('任务不存在', 404);
    if (task.status !== 'completed' || !task.report) throw authError('仅已完成的报告可以分享', 409);
    const { expiresInDays, hideRevenue } = req.body || {};
    if (![1,7,30].includes(expiresInDays) || typeof hideRevenue !== 'boolean') throw authError('分享期限或隐藏收入设置无效');
    let dataset = null; try { dataset = workspace.app.locals.store.get('dataset', task.datasetId); } catch { /* Legacy or missing dataset has unknown provenance. */ }
    res.status(201).json(accounts.createShare(session.user.id, task.id, shareSnapshot(task.report, hideRevenue, dataset?.source), expiresInDays, hideRevenue));
  });
  app.get('/api/tasks/:id/shares', (req, res) => {
    const session = requireSession(req); const workspace = workspaceFor(session.user.id);
    let task; try { task = workspace.app.locals.store.get('task', req.params.id); } catch { throw authError('任务不存在', 404); }
    if (!task) throw authError('任务不存在', 404);
    res.json({ shares: accounts.shares(session.user.id, task.id) });
  });
  app.delete('/api/shares/:id', (req, res) => {
    const session = requireSession(req); if (!accounts.revokeShare(session.user.id, req.params.id)) throw authError('分享不存在', 404);
    res.json({ ok:true });
  });
  app.use((req, res, next) => {
    if (!req.path.toLowerCase().startsWith('/api/')) return next();
    req.cloudSession = requireSession(req);
    const workspace = workspaceFor(req.cloudSession.user.id);
    if (workspace.refs >= (options.maxWorkspaceRequests || 8)) throw authError('当前账号请求过多，请稍后再试', 429);
    workspace.refs++; workspace.lastUsed = now();
    let released = false; const release = () => { if (!released) { released = true; workspace.refs--; workspace.lastUsed = now(); } }; res.locals.releaseWorkspaceRequest = release; res.once('finish', release); res.once('close', release);
    workspace.app(req, res, next);
  });
  const distDir = options.distDir || path.join(root, 'dist');
  if (existsSync(distDir)) { app.use(express.static(distDir, { index: false })); app.get('/{*path}', (req, res, next) => { if (req.accepts('html')) res.sendFile(path.join(distDir, 'index.html')); else next(); }); }
  app.use((error, _req, res, _next) => {
    const status = error.type === 'entity.parse.failed' ? 400 : error.status || 500;
    res.status(status).json({ error: status >= 500 ? '服务繁忙或处理失败，请稍后重试' : error.type === 'entity.parse.failed' ? 'JSON 请求格式无效' : error.message });
  });
  return app;
}
