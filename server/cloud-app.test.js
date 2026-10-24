import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { request } from 'node:http';
const module = await import('./cloud-app.js').catch(() => ({}));
const password = 'account-password-2026';
const taskBody = (datasetId, extra = {}) => ({ title: '账号分析', goal: '核对活跃与收入', domain: 'game', mode: 'automatic', useAI: false, datasetId, ...extra });

async function setup(t, options = {}) {
  assert.equal(typeof module.createCloudApp, 'function', '必须提供 createCloudApp');
  const dir = await mkdtemp(path.join(tmpdir(), 'dataagent-cloud-'));
  const publicUrl = options.production ? 'https://cloud.example.test' : 'http://localhost:3002';
  let app, server, base;
  const start = async () => {
    app = module.createCloudApp({ dataDir: dir, publicUrl, ...options });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const close = async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); };
  await start();
  t.after(async () => { await close(); await rm(dir, { recursive: true, force: true }); });
  const client = (initial = '') => {
    let cookie = initial;
    const api = async (route, method = 'GET', body, headers = {}) => {
      const multipart = body instanceof FormData;
      const wireBody = multipart ? new Request('http://localhost', { method: 'POST', body }) : null;
      const encoded = multipart ? Buffer.from(await wireBody.arrayBuffer()) : body ? Buffer.from(JSON.stringify(body)) : undefined;
      const result = await new Promise((resolve, reject) => {
        const req = request(base + route, { method, headers: { host: new URL(publicUrl).host, ...(cookie ? { cookie } : {}), ...(!['GET', 'HEAD'].includes(method) ? { origin: publicUrl } : {}), ...(body ? { 'content-type': multipart ? wireBody.headers.get('content-type') : 'application/json', 'content-length': encoded.length } : {}), ...headers } }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() })); });
        req.once('error', reject); req.end(encoded);
      });
      const setCookie = result.headers['set-cookie']?.[0] || null;
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = result.text;
      let data; try { data = JSON.parse(text); } catch { data = { text }; }
      return { ...data, status: result.status, setCookie };
    };
    return { api, cookie: () => cookie };
  };
  const register = async username => { const c = client(); const r = await c.api('/api/auth/register', 'POST', { username, displayName: `用户${username}`, password }); assert.equal(r.status, 201, r.error); return { ...c, user: r.user }; };
  return { client, register, dir, get app() { return app; }, get base() { return base; }, restart: async () => { await close(); await start(); } };
}
async function waitFor(c, id, status) {
  for (let i = 0; i < 200; i++) { const r = await c.api(`/api/tasks/${id}`); if (r.task?.status === status) return r; if (r.task?.status === 'failed') throw new Error(r.task.error); await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(`任务未达到 ${status}`);
}
async function files(dir) {
  const result = [];
  for (const e of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) result.push(...await files(p)); else result.push(p); }
  return result;
}

test('cloud runtime, password hashing, opaque secure cookie and duplicate identity validation', async t => {
  const s = await setup(t, { production: true });
  const anon = s.client();
  assert.deepEqual(await anon.api('/api/runtime'), { mode: 'cloud', authRequired: true, serviceName: 'DataAgent', version: '1.1.0', modelHosts: [], status: 200, setCookie: null });
  assert.equal((await anon.api('/api/bootstrap')).status, 401);
  assert.equal((await anon.api('/api/auth/session')).user, null);
  const r = await anon.api('/api/auth/register', 'POST', { username: 'Alice_01', displayName: '阿丽丝', password });
  assert.equal(r.status, 201);
  assert.equal(r.user.username, 'alice_01');
  assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /SameSite=Strict/); assert.match(r.setCookie, /Secure/);
  assert.equal((await s.client().api('/api/auth/register', 'POST', { username: 'ALICE_01', displayName: '重复', password })).status, 409);
  assert.equal((await s.client().api('/api/auth/register', 'POST', { username: 'bad', displayName: '短密码', password: 'short' })).status, 400);
  const token = anon.cookie().split('=')[1];
  const db = new DatabaseSync(path.join(s.dir, 'accounts.sqlite'));
  try {
    const user = db.prepare('SELECT * FROM users').get();
    assert.equal(user.password_hash.includes(password), false); assert.equal(user.password_hash.startsWith('scrypt$32768$8$3$'), true);
    const session = db.prepare('SELECT * FROM sessions').get();
    assert.equal(session.token_hash, createHash('sha256').update(token).digest('hex'));
    assert.equal(JSON.stringify(session).includes(token), false);
  } finally { db.close(); }
});

test('A/B resources, task operations, reports and trial ledgers remain isolated', async t => {
  const s = await setup(t); const a = await s.register('alice'); const b = await s.register('bob');
  const ab = await a.api('/api/bootstrap'); const bb = await b.api('/api/bootstrap');
  assert.equal(ab.wallet.balance, 500); assert.equal(bb.wallet.balance, 500);
  assert.notEqual(ab.datasets[0].id, bb.datasets[0].id);
  const form = new FormData(); form.append('files', new Blob(['user_id,registered_at,channel\na,2026-10-01,自然\n']), 'users.csv');
  const uploaded = await a.api('/api/datasets/upload', 'POST', form); assert.equal(uploaded.status, 201, uploaded.error);
  const id = uploaded.dataset.id;
  assert.equal((await b.api(`/api/datasets/${id}`)).status, 404);
  assert.equal((await b.api(`/api/datasets/${id}`, 'DELETE')).status, 404);
  assert.equal((await b.api('/api/tasks', 'POST', taskBody(id))).status, 404);
  const created = await a.api('/api/tasks', 'POST', taskBody(ab.datasets[0].id));
  assert.equal(created.status, 201); await waitFor(a, created.task.id, 'completed');
  for (const [suffix, method, body] of [['', 'GET'], ['/report.md', 'GET'], ['/cancel', 'POST', {}], ['/approve', 'POST', {}], ['/message', 'POST', { message: '越权' }]]) assert.equal((await b.api(`/api/tasks/${created.task.id}${suffix}`, method, body)).status, 404);
  assert.equal((await a.api(`/api/tasks/${created.task.id}/report.md`)).status, 200);
  assert.deepEqual((await a.api('/api/wallet')).wallet, { balance: 480, frozen: 0, spent: 20 });
  assert.deepEqual((await b.api('/api/wallet')).wallet, { balance: 500, frozen: 0, spent: 0 });
});

test('same-account sessions isolate API keys; account settings, data and wallet survive restart', async t => {
  const seen = [];
  const s = await setup(t, { modelHosts: ['model.example.test'], fetchImpl: async (_url, init) => { seen.push(init.headers.authorization); assert.equal(init.redirect, 'error'); return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })); } });
  const a = await s.register('session_user'); const b = s.client();
  assert.equal((await b.api('/api/auth/login', 'POST', { username: 'SESSION_USER', password })).status, 200);
  const opts = { provider: '供应商', baseUrl: 'https://model.example.test/v1', model: 'same-account' };
  await a.api('/api/settings', 'PUT', { ...opts, apiKey: 'secret-session-alpha' });
  assert.equal((await b.api('/api/settings')).settings.hasKey, false);
  await b.api('/api/settings', 'PUT', { ...opts, apiKey: 'secret-session-beta' });
  assert.equal((await a.api('/api/settings/test', 'POST', {})).status, 200);
  assert.equal((await b.api('/api/settings/test', 'POST', {})).status, 200);
  assert.deepEqual(seen, ['Bearer secret-session-alpha', 'Bearer secret-session-beta']);
  const boot = await a.api('/api/bootstrap'); const created = await a.api('/api/tasks', 'POST', taskBody(boot.datasets[0].id)); await waitFor(a, created.task.id, 'completed');
  for (const file of await files(s.dir)) { const contents = await readFile(file); for (const secret of ['secret-session-alpha', 'secret-session-beta', password, a.cookie().split('=')[1]]) assert.equal(contents.includes(Buffer.from(secret)), false, path.basename(file)); }
  await s.restart();
  assert.equal((await a.api('/api/auth/session')).user.id, a.user.id);
  const restored = await a.api('/api/bootstrap'); assert.equal(restored.wallet.spent, 20); assert.equal(restored.settings.model, opts.model); assert.equal(restored.settings.hasKey, false);
  const login = s.client(); assert.equal((await login.api('/api/auth/login', 'POST', { username: a.user.username, password })).status, 200);
});

test('logout, password changes and expiry revoke sessions and memory credentials', async t => {
  let time = Date.now(); const s = await setup(t, { now: () => time, sessionTtlMs: 10000 });
  const a = await s.register('revoke_user'); const stale = s.client(a.cookie());
  await a.api('/api/auth/logout', 'POST', {}); assert.equal((await stale.api('/api/bootstrap')).status, 401);
  await a.api('/api/auth/login', 'POST', { username: 'revoke_user', password });
  const b = s.client(); await b.api('/api/auth/login', 'POST', { username: 'revoke_user', password });
  assert.equal((await a.api('/api/auth/change-password', 'POST', { currentPassword: 'wrong-password', newPassword: 'changed-password-2026' })).status, 401);
  assert.equal((await a.api('/api/auth/change-password', 'POST', { currentPassword: password, newPassword: 'changed-password-2026' })).status, 200);
  assert.equal((await b.api('/api/bootstrap')).status, 401);
  assert.equal((await a.api('/api/auth/login', 'POST', { username: 'revoke_user', password })).status, 401);
  assert.equal((await a.api('/api/auth/login', 'POST', { username: 'revoke_user', password: 'changed-password-2026' })).status, 200);
  time += 10001; assert.equal((await a.api('/api/auth/session')).user, null); assert.equal((await a.api('/api/bootstrap')).status, 401);
});

test('host and same-origin validation rejects cross-site writes and ignores spoofed XFF by default', async t => {
  const s = await setup(t, { authRateLimit: { maxIp: 3, maxUsername: 3, windowMs: 60000 } });
  const c = s.client();
  assert.equal((await c.api('/api/runtime', 'GET', undefined, { host: 'evil.test' })).status, 403);
  assert.equal((await c.api('/api/auth/register', 'POST', {}, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await c.api('/api/auth/register', 'POST', {}, { origin: '', 'sec-fetch-site': 'cross-site' })).status, 403);
  for (let i = 0; i < 3; i++) assert.equal((await c.api('/api/auth/login', 'POST', { username: `missing_${i}`, password }, { 'x-forwarded-for': `10.0.0.${i}` })).status, 401);
  assert.equal((await c.api('/api/auth/login', 'POST', { username: 'different', password }, { 'x-forwarded-for': '10.0.0.100' })).status, 429);
});

test('model whitelist is exact HTTPS and denies requests before credentials or wallet are affected', async t => {
  let calls = 0; const s = await setup(t, { modelHosts: ['model.example.test'], fetchImpl: async () => { calls++; return new Response('{}'); } });
  const a = await s.register('whitelist_user');
  for (const baseUrl of ['https://evil.test/v1', 'https://model.example.test.evil.test/v1', 'http://127.0.0.1:9888/v1', 'https://model.example.test:444/v1']) assert.equal((await a.api('/api/settings', 'PUT', { baseUrl, apiKey: 'not-persisted' })).status, 400);
  assert.equal((await a.api('/api/settings/test', 'POST', {})).status, 400);
  const boot = await a.api('/api/bootstrap'); assert.equal((await a.api('/api/tasks', 'POST', taskBody(boot.datasets[0].id, { useAI: true }))).status, 400);
  assert.equal(calls, 0); assert.equal((await a.api('/api/wallet')).wallet.balance, 500);
  assert.throws(() => module.createCloudApp({ dataDir: s.dir, production: true, publicUrl: 'http://example.test' }), /HTTPS/);
});

test('cloud caps concurrent tasks, dataset count and active workspaces without evicting paused tasks', async t => {
  const s = await setup(t, { maxWorkspaces: 1, workspaceIdleMs: 1 }); const a = await s.register('capacity_a'); const b = await s.register('capacity_b');
  const boot = await a.api('/api/bootstrap');
  const one = await a.api('/api/tasks', 'POST', taskBody(boot.datasets[0].id, { mode: 'collaborative' })); await waitFor(a, one.task.id, 'awaiting_approval');
  const two = await a.api('/api/tasks', 'POST', taskBody(boot.datasets[0].id, { mode: 'collaborative' })); await waitFor(a, two.task.id, 'awaiting_approval');
  assert.equal((await a.api('/api/tasks', 'POST', taskBody(boot.datasets[0].id))).status, 429);
  assert.equal((await b.api('/api/bootstrap')).status, 503);
  await a.api(`/api/tasks/${one.task.id}/cancel`, 'POST', {}); await a.api(`/api/tasks/${two.task.id}/cancel`, 'POST', {});
  assert.equal((await b.api('/api/bootstrap')).status, 200);
  assert.equal((await a.api('/api/bootstrap')).wallet.balance, 500);
  for (let i = 1; i < 20; i++) assert.equal((await a.api('/api/datasets/demo', 'POST', {})).status, 201);
  assert.equal((await a.api('/api/datasets/demo', 'POST', {})).status, 429);
});

test('unconfigured development service accepts its actual loopback port while production requires PUBLIC_URL', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dataagent-cloud-dynamic-'));
  const app = module.createCloudApp({ dataDir: dir, production: false });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/runtime')).status, 200);
  const registration = await fetch(base + '/api/auth/register', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'dynamic_user', displayName: '随机端口', password }) });
  assert.equal(registration.status, 201);
  assert.throws(() => module.createCloudApp({ dataDir: dir, production: true }), /PUBLIC_URL/);
});

test('disconnecting a model-test client cannot evict its workspace while the async operation is in flight', async t => {
  let release; let entered;
  const gate = new Promise(resolve => { release = resolve; }); const started = new Promise(resolve => { entered = resolve; });
  const s = await setup(t, { maxWorkspaces: 1, maxWorkspaceRequests: 1, modelHosts: ['model.example.test'], fetchImpl: async () => { entered(); await gate; return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })); } });
  t.after(release);
  const a = await s.register('disconnect_a'); const b = await s.register('disconnect_b');
  await a.api('/api/settings', 'PUT', { baseUrl: 'https://model.example.test/v1', apiKey: 'disconnect-memory-key' });
  const req = request(s.base + '/api/settings/test', { method: 'POST', headers: { host: 'localhost:3002', origin: 'http://localhost:3002', cookie: a.cookie(), 'content-type': 'application/json' } });
  req.on('error', () => {}); req.end('{}'); await started; req.destroy(); await new Promise(resolve => setTimeout(resolve, 20));
  const blocked = await b.api('/api/bootstrap');
  const extra = a.api('/api/settings/test', 'POST', {}); await new Promise(resolve => setTimeout(resolve, 30)); release();
  assert.equal(blocked.status, 503);
  assert.equal((await extra).status, 429);
});

test('running AI task keeps its original session snapshot after logout and another session changes settings', async t => {
  const seen = [];
  const s = await setup(t, { modelHosts: ['first.example.test', 'second.example.test'], fetchImpl: async (url, init) => {
    seen.push({ url, model: JSON.parse(init.body).model, authorization: init.headers.authorization });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '聚合指标分析', findings: [], recommendations: ['补充背景'] }) } }] }));
  } });
  const a = await s.register('snapshot_cloud'); const b = s.client(); await b.api('/api/auth/login', 'POST', { username: 'snapshot_cloud', password });
  await a.api('/api/settings', 'PUT', { baseUrl: 'https://first.example.test/v1', model: 'first-model', apiKey: 'first-session-snapshot' });
  const boot = await a.api('/api/bootstrap'); const created = await a.api('/api/tasks', 'POST', taskBody(boot.datasets[0].id, { mode: 'collaborative', useAI: true }));
  await waitFor(a, created.task.id, 'awaiting_approval'); await a.api('/api/auth/logout', 'POST', {});
  await b.api('/api/settings', 'PUT', { baseUrl: 'https://second.example.test/v1', model: 'second-model', apiKey: 'second-session-snapshot' });
  await b.api(`/api/tasks/${created.task.id}/approve`, 'POST', { stepId: 'plan' }); await waitFor(b, created.task.id, 'awaiting_approval');
  await b.api(`/api/tasks/${created.task.id}/approve`, 'POST', { stepId: 'report' }); const done = await waitFor(b, created.task.id, 'completed');
  assert.equal(done.task.report.source, 'ai');
  assert.deepEqual(seen, [{ url: 'https://first.example.test/v1/chat/completions', model: 'first-model', authorization: 'Bearer first-session-snapshot' }]);
  for (const file of await files(s.dir)) { const contents = await readFile(file); assert.equal(contents.includes(Buffer.from('first-session-snapshot')), false); assert.equal(contents.includes(Buffer.from('second-session-snapshot')), false); }
});

test('empty model whitelist denies all AI calls while deterministic analysis remains available', async t => {
  let calls = 0; const s = await setup(t, { modelHosts: [], fetchImpl: async () => { calls++; throw new Error('不应请求'); } });
  const a = await s.register('empty_whitelist');
  const denied = await a.api('/api/settings', 'PUT', { baseUrl: 'https://api.openai.com/v1', apiKey: 'blocked-memory-key' });
  assert.equal(denied.status, 400); assert.match(denied.error, /白名单/);
  assert.match((await a.api('/api/settings/test', 'POST', {})).error, /白名单/);
  const boot = await a.api('/api/bootstrap');
  assert.match((await a.api('/api/tasks', 'POST', taskBody(boot.datasets[0].id, { useAI: true }))).error, /白名单/);
  const created = await a.api('/api/tasks', 'POST', taskBody(boot.datasets[0].id)); assert.equal(created.status, 201); await waitFor(a, created.task.id, 'completed');
  assert.equal(calls, 0);
});

test('cloud API and static responses provide the same restrictive browser security headers', async t => {
  const s = await setup(t, { publicUrl: undefined });
  for (const route of ['/', '/api/runtime']) {
    const response = await fetch(s.base + route);
    assert.equal(response.headers.get('content-security-policy'), "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'same-origin');
    await response.arrayBuffer();
  }
});
