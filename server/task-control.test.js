import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { createCloudApp } from './cloud-app.js';
import { createDataset } from './datasets.js';

async function setup(t, options = {}, cloud = false) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dataagent-control-'));
  let app, server, base;
  const start = async () => {
    app = (cloud ? createCloudApp : createApp)({ dataDir: dir, serveStatic: false, ...options });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  await start();
  const streams = [];
  t.after(async () => { for (const controller of streams) controller.abort(); app.locals.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const client = () => {
    let cookie = '';
    const api = async (route, method = 'GET', body) => {
      const res = await fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json', origin: base } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      return { status: res.status, ...await res.json() };
    };
    const events = async (headers = {}, route = '/api/tasks/events') => {
      const controller = new AbortController(); streams.push(controller);
      const res = await fetch(base + route, { headers: { ...(cookie ? { cookie } : {}), ...headers }, signal: controller.signal });
      const reader = res.body.getReader(); let buffer = '';
      return { status: res.status, headers: res.headers, controller, reader, next: async () => {
        while (!buffer.includes('\n\n')) { const chunk = await reader.read(); if (chunk.done) return null; buffer += new TextDecoder().decode(chunk.value); }
        const end = buffer.indexOf('\n\n'); const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const event = block.match(/^event: (.+)$/m)?.[1]; const data = block.match(/^data: (.+)$/m)?.[1];
        return { event, data: data ? JSON.parse(data) : null };
      } };
    };
    return { api, events };
  };
  const c = client();
  return { get app() { return app; }, client, ...c, restart: async () => { for (const controller of streams) controller.abort(); app.locals.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await start(); } };
}
const input = (datasetId, extra = {}) => ({ title: '任务控制测试', goal: '保留原始业务目标', mode: 'collaborative', domain: 'game', datasetId, useAI: false, ...extra });
async function waitFor(api, id, status, stepId) {
  for (let i = 0; i < 200; i++) {
    const r = await api(`/api/tasks/${id}`);
    if (r.task?.status === status && (!stepId || r.task.steps[r.task.currentStep].id === stepId)) return r;
    if (r.task?.status === 'failed' && status !== 'failed') throw new Error(r.task.error);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`任务未达到 ${status}/${stepId || ''}`);
}
const retry = (api, id, body = {}) => api(`/api/tasks/${id}/retry`, 'POST', { strategy: 'resume', useAI: false, ...body });
const register = (c, username) => c.api('/api/auth/register', 'POST', { username, displayName: username, password: 'account-password-2026' });

for (const cloud of [false, true]) test(`${cloud ? 'cloud' : 'local'} runtime advertises implemented task capabilities without authentication`, async t => {
  const s = await setup(t, {}, cloud); const runtime = await s.api('/api/runtime');
  assert.equal(runtime.status, 200); assert.equal(runtime.mode, cloud ? 'cloud' : 'local'); assert.equal(runtime.authRequired, cloud);
  assert.equal(runtime.serviceName, 'DataAgent'); assert.equal(runtime.version, '1.1.0');
  assert.deepEqual(runtime.capabilities, { taskEvents: true, taskRecovery: true, taskSkip: true, taskSummaries: true, idempotentTasks: true, walletVersion: true, reportExplore: true, reportMetadata: true, reportContinuation: true, ...(cloud ? { reportSharing: true } : {}) });
});

test('summary is bounded, preserves older active tasks, and excludes full task content', async t => {
  const { api, app } = await setup(t);
  const b = await api('/api/bootstrap');
  const active = await api('/api/tasks', 'POST', input(b.datasets[0].id));
  await waitFor(api, active.task.id, 'awaiting_approval');
  const template = app.locals.store.list('task').find(task => task.status === 'completed');
  for (let i = 0; i < 105; i++) app.locals.store.put('task', { ...template, id: `history-${i}`, goal: 'private-business-context', _analysis: { private: true } });
  const r = await api('/api/tasks/summary');
  assert.equal(r.status, 200);
  assert.ok(r.summaries.length <= 125);
  assert.ok(r.summaries.some(task => task.id === active.task.id));
  assert.deepEqual(r.wallet, { balance: 480, frozen: 20, spent: 0 });
  for (const task of r.summaries) for (const field of ['report', 'messages', 'events', 'goal', 'preview', '_analysis', 'clientRequestId']) assert.equal(Object.hasOwn(task, field), false, field);
  assert.equal(JSON.stringify(r).includes('private-business-context'), false);
});

test('SSE sends a current snapshot, committed changes, heartbeat and cleans up bounded connections', async t => {
  let connectionClosed;
  const closed = new Promise(resolve => { connectionClosed = resolve; });
  const { api, events } = await setup(t, { maxTaskEventConnections: 1, taskHeartbeatMs: 20, onTaskEventConnect: (_req, res) => res.once('close', connectionClosed) });
  const stream = await events();
  assert.equal(stream.status, 200);
  const first = await stream.next();
  assert.equal(first.event, 'snapshot');
  assert.ok(first.data.summaries.every(task => !task.report && !task.messages));
  const b = await api('/api/bootstrap');
  const c = await api('/api/tasks', 'POST', input(b.datasets[0].id));
  let snapshot;
  for (let i = 0; i < 20; i++) { const item = await stream.next(); if (item.event === 'snapshot' && item.data.summaries.some(task => task.id === c.task.id)) { snapshot = item; break; } }
  assert.equal(snapshot.data.wallet.frozen, 20, '事件只能观察提交后的账本');
  const refused = await events(); assert.equal(refused.status, 429); refused.controller.abort();
  let heartbeat;
  for (let i = 0; i < 20; i++) { const item = await stream.next(); if (item.event === 'heartbeat') { heartbeat = item; break; } }
  assert.equal(typeof heartbeat.data.timestamp, 'string');
  stream.controller.abort();
  let timeout;
  try { await Promise.race([closed, new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('已中止的 SSE 未及时释放连接')), 3000); })]); }
  finally { clearTimeout(timeout); }
  const reconnected = await events(); assert.equal(reconnected.status, 200); assert.equal((await reconnected.next()).event, 'snapshot'); reconnected.controller.abort();
});

test('create and retry request IDs prevent repeat freezes and reject different input', async t => {
  const { api } = await setup(t);
  const b = await api('/api/bootstrap');
  const body = input(b.datasets[0].id, { clientRequestId: 'create-once' });
  const c = await api('/api/tasks', 'POST', body);
  const same = await api('/api/tasks', 'POST', body);
  assert.equal(same.task.id, c.task.id);
  assert.equal((await api('/api/tasks', 'POST', { ...body, goal: '另一个目标' })).status, 409);
  await waitFor(api, c.task.id, 'awaiting_approval');
  await api(`/api/tasks/${c.task.id}/message`, 'POST', { message: '原任务业务背景' });
  await api(`/api/tasks/${c.task.id}/cancel`, 'POST', {});
  const original = (await api(`/api/tasks/${c.task.id}`)).task;
  const r = await retry(api, c.task.id, { clientRequestId: 'retry-once' });
  assert.equal(r.status, 201);
  assert.notEqual(r.task.id, c.task.id); assert.equal(r.task.sourceTaskId, c.task.id);
  assert.equal(r.task.goal, original.goal); assert.equal(r.task.mode, original.mode);
  assert.ok(r.task.messages.some(m => m.content === '原任务业务背景'));
  assert.equal(r.task.steps[0].status, 'completed', 'resume可沿用已完成质量检查');
  assert.deepEqual(r.wallet, { balance: 480, frozen: 20, spent: 0 });
  const repeated = await retry(api, c.task.id, { clientRequestId: 'retry-once' });
  assert.equal(repeated.task.id, r.task.id);
  assert.equal((await retry(api, c.task.id, { clientRequestId: 'retry-once', strategy: 'restart' })).status, 409);
  assert.deepEqual((await api(`/api/tasks/${c.task.id}`)).task, original);
  await api(`/api/tasks/${r.task.id}/cancel`, 'POST', {});
  const ledger = await api('/api/wallet');
  for (const id of [c.task.id, r.task.id]) { assert.equal(ledger.transactions.filter(x => x.taskId === id && x.type === 'freeze').length, 1); assert.equal(ledger.transactions.filter(x => x.taskId === id && x.type === 'release').length, 1); }
});

test('retry validates state, actual records, current key, balance and concurrency before freezing', async t => {
  const { api, app } = await setup(t, { maxConcurrentTasks: 1 });
  const b = await api('/api/bootstrap'); const dataset = app.locals.store.list('dataset')[0];
  assert.equal((await retry(api, b.tasks[0].id)).status, 409);
  const c = await api('/api/tasks', 'POST', input(dataset.id));
  assert.equal((await retry(api, c.task.id)).status, 409);
  await api(`/api/tasks/${c.task.id}/cancel`, 'POST', {});
  assert.equal((await retry(api, c.task.id, { useAI: true })).status, 400);
  assert.equal((await retry(api, c.task.id, { strategy: 'anything' })).status, 400);
  assert.equal((await retry(api, c.task.id, { skipSteps: ['quality'] })).status, 400);
  assert.equal((await retry(api, c.task.id, { mode: null })).status, 400);
  assert.equal((await retry(api, c.task.id, { skipSteps: null })).status, 400);
  const other = await api('/api/tasks', 'POST', input(dataset.id));
  assert.equal((await retry(api, c.task.id)).status, 429);
  await api(`/api/tasks/${other.task.id}/cancel`, 'POST', {});
  const before = await api('/api/wallet');
  app.locals.store.put('dataset', { ...dataset, records: { activity: [{ user_id: 'private', event_time: '2099-01-01' }] } });
  assert.equal((await retry(api, c.task.id)).status, 400); assert.deepEqual(await api('/api/wallet'), before);
  app.locals.store.put('dataset', dataset);
  app.locals.store.db.prepare('UPDATE wallet SET balance=0 WHERE id=1').run();
  assert.equal((await retry(api, c.task.id)).status, 402);
});

test('skipping optional branches produces real nulls and no findings, while mandatory and executed steps are protected', async t => {
  const { api } = await setup(t); const b = await api('/api/bootstrap');
  const c = await api('/api/tasks', 'POST', input(b.datasets[0].id));
  await waitFor(api, c.task.id, 'awaiting_approval', 'plan');
  for (const stepId of ['quality', 'plan', 'activity', 'report', 'verify']) assert.equal((await api(`/api/tasks/${c.task.id}/skip`, 'POST', { stepId })).status, 400);
  for (const stepId of ['retention', 'monetization', 'insights']) assert.equal((await api(`/api/tasks/${c.task.id}/skip`, 'POST', { stepId })).status, 200);
  await api(`/api/tasks/${c.task.id}/approve`, 'POST', { stepId: 'plan' });
  await waitFor(api, c.task.id, 'awaiting_approval', 'report');
  await api(`/api/tasks/${c.task.id}/approve`, 'POST', { stepId: 'report' });
  const done = await waitFor(api, c.task.id, 'completed');
  assert.deepEqual(done.task.skippedSteps.sort(), ['insights', 'monetization', 'retention']);
  for (const id of ['d1_retention', 'd7_retention', 'revenue', 'arppu', 'pay_rate', 'arpdau']) assert.equal(done.task.report.metrics.find(m => m.id === id).value, null, id);
  assert.ok(done.task.report.daily.every(day => day.revenue === null && day.payers === null));
  assert.ok(done.task.report.channels.every(channel => channel.revenue === null && channel.d1 === null));
  assert.deepEqual(done.task.report.retention, []); assert.deepEqual(done.task.report.findings, []); assert.deepEqual(done.task.report.recommendations, []);
  assert.match(done.task.report.methodology.join(' '), /用户.*跳过/);
  assert.equal(done.task.report.quality.rows, b.tasks[0].report.quality.rows);
  assert.equal((await api(`/api/tasks/${c.task.id}/skip`, 'POST', { stepId: 'retention' })).status, 409);
});

test('AI input and output respect skipped branch masks; resume does not reuse old model report', async t => {
  const requests = [];
  const { api, app } = await setup(t, { fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: '模型观察', findings: [{ title: '留存观察', detail: '不得恢复跳过结果', severity: 'neutral', evidence: '无' }], recommendations: ['不得恢复洞察'] }) } }] }); } });
  await api('/api/settings', 'PUT', { baseUrl: 'https://api.openai.com/v1', model: 'current-model', apiKey: 'current-session-key' });
  const b = await api('/api/bootstrap'); const original = app.locals.store.get('task', b.tasks[0].id);
  original.status = 'failed'; original.useAI = true; original.steps[7].status = 'failed'; app.locals.store.put('task', original);
  const r = await retry(api, original.id, { useAI: true, mode: 'collaborative', skipSteps: ['retention', 'monetization', 'insights'] });
  assert.equal(r.status, 201); assert.equal(r.task.model, 'current-model'); assert.equal(r.task.report, undefined);
  await waitFor(api, r.task.id, 'awaiting_approval', 'report');
  assert.equal(requests.length, 0, '协作恢复仍需明确确认报告');
  await api(`/api/tasks/${r.task.id}/approve`, 'POST', { stepId: 'report' });
  const done = await waitFor(api, r.task.id, 'completed');
  const sent = JSON.parse(requests[0].messages[1].content).aggregates;
  assert.ok(sent.metrics.filter(m => ['d1_retention', 'd7_retention', 'revenue', 'arppu', 'pay_rate', 'arpdau'].includes(m.id)).every(m => m.value === null));
  assert.deepEqual(sent.retention, []); assert.ok(sent.channels.every(c => c.d1 === null && c.revenue === null));
  assert.deepEqual(done.task.report.findings, []); assert.deepEqual(done.task.report.recommendations, []);
  assert.equal(JSON.stringify(done).includes('current-session-key'), false);
});

test('cloud events use isolated cookie sessions, stop on revoke/expiry and release request slots', async t => {
  let now = Date.now();
  const { client } = await setup(t, { now: () => now, sessionTtlMs: 1000, taskHeartbeatMs: 20, maxTaskEventConnections: 1, maxWorkspaceRequests: 1 }, true);
  const anonymous = client(); assert.equal((await anonymous.api('/api/tasks/summary')).status, 401);
  const a = client(), b = client(); await register(a, 'control_alice'); await register(b, 'control_bob');
  const boot = await a.api('/api/bootstrap'); const c = await a.api('/api/tasks', 'POST', input(boot.datasets[0].id));
  await waitFor(a.api, c.task.id, 'awaiting_approval');
  const sa = await a.events(); assert.equal(sa.status, 200); assert.ok((await sa.next()).data.summaries.some(task => task.id === c.task.id));
  assert.equal((await a.api('/api/tasks/summary')).status, 200, '长连接不占普通请求槽');
  const sb = await b.events(); assert.equal(sb.status, 200); assert.equal((await sb.next()).data.summaries.some(task => task.id === c.task.id), false);
  assert.equal((await retry(b.api, c.task.id)).status, 404);
  await a.api('/api/auth/logout', 'POST', {});
  let ended = false; for (let i = 0; i < 10; i++) if (await sa.next() === null) { ended = true; break; } assert.equal(ended, true);
  now += 1001;
  ended = false; for (let i = 0; i < 10; i++) if (await sb.next() === null) { ended = true; break; } assert.equal(ended, true);
  assert.equal((await b.api('/api/tasks/summary')).status, 401);
});

test('model failure exposes only a stable error code in task summaries and API errors', async t => {
  const { api } = await setup(t, { fetchImpl: async () => Response.json({}, { status: 401 }) });
  await api('/api/settings', 'PUT', { baseUrl: 'https://api.openai.com/v1', model: 'test', apiKey: 'classified-secret' });
  const checked = await api('/api/settings/test', 'POST', {});
  assert.equal(checked.status, 400); assert.equal(checked.code, 'INVALID_KEY');
  const b = await api('/api/bootstrap'); const c = await api('/api/tasks', 'POST', input(b.datasets[0].id, { mode: 'automatic', useAI: true }));
  const failed = await waitFor(api, c.task.id, 'failed'); assert.equal(failed.task.errorCode, 'INVALID_KEY');
  const summary = (await api('/api/tasks/summary')).summaries.find(task => task.id === c.task.id);
  assert.equal(summary.errorCode, 'INVALID_KEY'); assert.equal(summary.error, undefined);
});

test('SSE retains large bounded snapshots without closing a healthy connection on its first write', { timeout: 15000 }, async t => {
  const { app, events } = await setup(t, { taskHeartbeatMs: 20 });
  const template = app.locals.store.list('task')[0];
  for (let i = 0; i < 100; i++) app.locals.store.put('task', { ...template, id: `large-${i}`, title: '长'.repeat(100), model: 'm'.repeat(200), datasetName: '数据'.repeat(80) });
  const stream = await events(); const first = await stream.next();
  assert.equal(first.event, 'snapshot'); assert.equal(first.data.summaries.length, 100);
  assert.equal((await stream.next())?.event, 'heartbeat');
  stream.controller.abort();
});

test('Store makes request-ID matching and freeze atomic even for independent task objects', async t => {
  const { app } = await setup(t); const store = app.locals.store;
  const template = store.list('task')[0];
  const first = { ...template, id: 'atomic-first', clientRequestId: 'atomic-request', _requestFingerprint: 'same-input' };
  const duplicate = { ...first, id: 'atomic-second' };
  store.createTask(first);
  assert.equal(store.createTask(duplicate).id, first.id);
  assert.equal(store.wallet().frozen, 20);
  assert.throws(() => store.createTask({ ...duplicate, id: 'atomic-different', _requestFingerprint: 'different-input' }), error => error.status === 409);
  assert.equal(store.get('task', duplicate.id), null);
});

test('resume invalidates old insight summaries when optional analytical branches change', async t => {
  const { app, api } = await setup(t); const source = app.locals.store.list('task')[0];
  source.status = 'failed'; source.steps[6].status = 'failed'; source.steps[7].status = 'pending'; app.locals.store.put('task', source);
  const r = await retry(api, source.id, { skipSteps: ['retention'] });
  assert.equal(r.status, 201);
  assert.equal(r.task.steps.find(step => step.id === 'insights').status, 'pending', '不能沿用包含旧留存结果的洞察步骤');
});

test('each optional branch masks only its own output and refuses skipping an already executed branch', async t => {
  const { api } = await setup(t); const b = await api('/api/bootstrap');
  for (const skipped of ['retention', 'monetization', 'insights']) {
    const c = await api('/api/tasks', 'POST', input(b.datasets[0].id));
    await waitFor(api, c.task.id, 'awaiting_approval', 'plan');
    await api(`/api/tasks/${c.task.id}/skip`, 'POST', { stepId: skipped });
    await api(`/api/tasks/${c.task.id}/approve`, 'POST', { stepId: 'plan' });
    await waitFor(api, c.task.id, 'awaiting_approval', 'report');
    const executed = skipped === 'retention' ? 'monetization' : 'retention';
    assert.equal((await api(`/api/tasks/${c.task.id}/skip`, 'POST', { stepId: executed })).status, 409);
    await api(`/api/tasks/${c.task.id}/approve`, 'POST', { stepId: 'report' });
    const { task } = await waitFor(api, c.task.id, 'completed');
    const metric = id => task.report.metrics.find(m => m.id === id).value;
    assert.equal(metric('d1_retention') === null, skipped === 'retention');
    assert.equal(metric('revenue') === null, skipped === 'monetization');
    if (skipped === 'retention') assert.ok(task.report.findings.every(f => !/留存/.test(f.title)));
    if (skipped === 'monetization') assert.ok(task.report.findings.every(f => !/商业化|收入/.test(f.title)));
    if (skipped === 'insights') { assert.deepEqual(task.report.findings, []); assert.deepEqual(task.report.recommendations, []); }
  }
});

test('restart releases the old freeze, loses model key and preserves request IDs for explicit new attempts', async t => {
  const s = await setup(t); const b = await s.api('/api/bootstrap');
  await s.api('/api/settings', 'PUT', { baseUrl: 'https://api.openai.com/v1', model: 'old', apiKey: 'lost-on-restart' });
  const body = input(b.datasets[0].id, { clientRequestId: 'persistent-create', useAI: true });
  const c = await s.api('/api/tasks', 'POST', body); await waitFor(s.api, c.task.id, 'awaiting_approval');
  await s.restart();
  const failed = await s.api(`/api/tasks/${c.task.id}`); assert.equal(failed.task.status, 'failed'); assert.equal(failed.wallet.frozen, 0);
  assert.equal((await s.api('/api/tasks', 'POST', body)).task.id, c.task.id);
  assert.equal((await retry(s.api, c.task.id, { useAI: true })).status, 400);
  const r = await retry(s.api, c.task.id, { clientRequestId: 'after-restart' }); assert.equal(r.status, 201); assert.equal(r.wallet.frozen, 20);
  await s.api(`/api/tasks/${r.task.id}/cancel`, 'POST', {}); await s.restart();
  assert.equal((await retry(s.api, c.task.id, { clientRequestId: 'after-restart' })).task.id, r.task.id);
  const ledger = await s.api('/api/wallet'); assert.deepEqual(ledger.wallet, { balance: 500, frozen: 0, spent: 0 });
  assert.equal(ledger.transactions.filter(x => x.type === 'freeze').length, 2); assert.equal(ledger.transactions.filter(x => x.type === 'release').length, 2);
});

test('cloud retry validates current session credentials and whitelist and snapshots the new model', async t => {
  const requests = [];
  const s = await setup(t, { modelHosts: ['allowed.example.test'], fetchImpl: async (url, init) => {
    requests.push({ url, authorization: init.headers.authorization, model: JSON.parse(init.body).model });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: '观察', findings: [], recommendations: [] }) } }] });
  } }, true);
  const a = s.client(), sameUser = s.client(), otherUser = s.client(); await register(a, 'retry_session'); await register(otherUser, 'retry_other');
  await sameUser.api('/api/auth/login', 'POST', { username: 'retry_session', password: 'account-password-2026' });
  const b = await a.api('/api/bootstrap'); const c = await a.api('/api/tasks', 'POST', input(b.datasets[0].id)); await a.api(`/api/tasks/${c.task.id}/cancel`, 'POST', {});
  const denied = await retry(a.api, c.task.id, { useAI: true }); assert.equal(denied.status, 400); assert.match(denied.error, /白名单/);
  await a.api('/api/settings', 'PUT', { baseUrl: 'https://allowed.example.test/v1', model: 'old-model', apiKey: 'old-session-key' });
  assert.equal((await retry(sameUser.api, c.task.id, { useAI: true })).status, 400);
  await sameUser.api('/api/settings', 'PUT', { baseUrl: 'https://allowed.example.test/v1', model: 'new-attempt-model', apiKey: 'new-session-key' });
  const body = { useAI: true, clientRequestId: 'scoped-request' }; const r = await retry(sameUser.api, c.task.id, body); assert.equal(r.status, 201);
  await a.api('/api/settings', 'PUT', { baseUrl: 'https://allowed.example.test/v1', model: 'changed-later', apiKey: 'changed-later-key' });
  await waitFor(sameUser.api, r.task.id, 'awaiting_approval', 'plan'); await sameUser.api(`/api/tasks/${r.task.id}/approve`, 'POST', { stepId: 'plan' });
  await waitFor(sameUser.api, r.task.id, 'awaiting_approval', 'report'); await sameUser.api(`/api/tasks/${r.task.id}/approve`, 'POST', { stepId: 'report' });
  await waitFor(sameUser.api, r.task.id, 'completed');
  assert.deepEqual(requests, [{ url: 'https://allowed.example.test/v1/chat/completions', authorization: 'Bearer new-session-key', model: 'new-attempt-model' }]);
  assert.equal((await retry(a.api, c.task.id, body)).task.id, r.task.id);
  const other = await otherUser.api('/api/bootstrap'); const separate = await otherUser.api('/api/tasks', 'POST', input(other.datasets[0].id, { clientRequestId: 'scoped-request' }));
  assert.equal(separate.status, 201); assert.notEqual(separate.task.id, r.task.id);
});

for (const cloud of [false, true]) test(`${cloud ? 'cloud' : 'local'} events reject cross-origin requests and emit heartbeat without reading task reports repeatedly`, async t => {
  const s = await setup(t, { taskHeartbeatMs: 20 }, cloud); if (cloud) await register(s, 'sse_origin');
  const denied = await s.events({ origin: 'https://evil.example' }); assert.equal(denied.status, 403); denied.controller.abort();
  const crossSite = await s.events({ 'sec-fetch-site': 'cross-site' }); assert.equal(crossSite.status, 403); crossSite.controller.abort();
  const sameSite = await s.events({ 'sec-fetch-site': 'same-site' }); assert.equal(sameSite.status, 403); sameSite.controller.abort();
  const stream = await s.events(); assert.equal(stream.status, 200); assert.equal(stream.headers.get('x-accel-buffering'), 'no'); await stream.next();
  for (let i = 0; i < 3; i++) assert.equal((await stream.next()).event, 'heartbeat');
  stream.controller.abort();
});

test('task observers see committed wallet state and no rolled-back task; closed streams allow workspace eviction', async t => {
  const s = await setup(t); const store = s.app.locals.store; const observed = [];
  const unsubscribe = store.subscribe(() => observed.push(store.wallet()));
  const template = store.list('task')[0];
  assert.throws(() => store.createTask({ ...template, id: '../invalid' }));
  assert.deepEqual(observed, []); assert.equal(store.wallet().balance, 500);
  store.createTask({ ...template, id: 'commit-observed' }); assert.deepEqual(observed, [{ balance: 480, frozen: 20, spent: 0 }]); unsubscribe();
  let now = Date.now(); const c = await setup(t, { now: () => now, maxWorkspaces: 1, workspaceIdleMs: 10000, taskHeartbeatMs: 20 }, true);
  const a = c.client(), b = c.client(); await register(a, 'evict_stream_a'); await register(b, 'evict_stream_b');
  const stream = await a.events(); await stream.next();
  assert.equal((await b.api('/api/tasks/summary')).status, 503);
  stream.controller.abort(); await new Promise(resolve => setTimeout(resolve, 30)); now += 10001; c.app.locals.cleanupWorkspaces();
  assert.equal((await b.api('/api/tasks/summary')).status, 200);
});

for (const futureUsers of [false, true]) for (const useAI of [false, true]) test(`payment-only recovery skipping monetization preserves quality with null operational results (AI=${useAI}, futureUsers=${futureUsers})`, async t => {
  const requests = [];
  const { app, api } = await setup(t, { fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: '成功支付收入 9876.54，付费人数 1', findings: [{ title: '商业化', detail: '收入 9876.54', severity: 'neutral', evidence: '付费人数 1' }], recommendations: ['提高收入'] }) } }] });
  } });
  const dataset = createDataset({ ...(futureUsers ? { users: [{ user_id: 'future-player', registered_at: '2099-01-01', channel: '未来' }] } : {}), payments: [{ order_id: 'private-payment', user_id: 'private-player', paid_at: '2026-10-01', amount: '9876.54', currency: 'USD', status: 'paid' }] });
  app.locals.store.put('dataset', dataset);
  const source = await api('/api/tasks', 'POST', input(dataset.id));
  await waitFor(api, source.task.id, 'awaiting_approval', 'plan'); await api(`/api/tasks/${source.task.id}/cancel`, 'POST', {});
  if (useAI) await api('/api/settings', 'PUT', { baseUrl: 'https://api.openai.com/v1', model: 'test', apiKey: 'only-payment-key' });
  const r = await retry(api, source.task.id, { strategy: 'restart', useAI, skipSteps: ['monetization'] }); assert.equal(r.status, 201);
  await waitFor(api, r.task.id, 'awaiting_approval', 'plan'); await api(`/api/tasks/${r.task.id}/approve`, 'POST', { stepId: 'plan' });
  await waitFor(api, r.task.id, 'awaiting_approval', 'report'); await api(`/api/tasks/${r.task.id}/approve`, 'POST', { stepId: 'report' });
  const done = await waitFor(api, r.task.id, 'completed'); const report = done.task.report;
  assert.ok(report.metrics.every(metric => metric.value === null && metric.change === null));
  assert.equal(report.daily[0].date, '2026-10-01'); assert.ok(report.daily.every(day => day.dau === null && day.newUsers === null && day.revenue === null && day.payers === null));
  if (!futureUsers) assert.equal(report.daily.length, 1);
  assert.equal(report.quality.rows, futureUsers ? 2 : 1); assert.equal(report.currency, 'USD');
  assert.deepEqual(report.findings, []); assert.deepEqual(report.recommendations, []);
  assert.match(report.summary, /全部可计算运营分支已跳过，仅保留质量检查/);
  assert.equal(JSON.stringify(report).includes('9876.54'), false); assert.equal(JSON.stringify(report).includes('付费人数 1'), false);
  if (useAI) {
    assert.equal(requests.length, 1);
    const sent = JSON.parse(requests[0].messages[1].content).aggregates;
    assert.ok(sent.metrics.every(metric => metric.value === null)); assert.ok(sent.daily.every(day => day.revenue === null && day.payers === null));
    assert.equal(JSON.stringify(sent).includes('9876.54'), false); assert.deepEqual(sent.retention, []); assert.deepEqual(sent.channels, []);
  }
  assert.deepEqual(done.wallet, { balance: 480, frozen: 0, spent: 20 });
});

for (const cloud of [false, true]) test(`${cloud ? 'cloud' : 'local'} SSE origin guard covers route slash and casing variants`, async t => {
  const s = await setup(t, {}, cloud); if (cloud) await register(s, 'sse_variants');
  const routes = ['/api/tasks/events/', '/api/tasks/EVENTS', '/api/tasks/EVENTS/', '/API/TASKS/EVENTS', '/API/TASKS/EVENTS/'];
  for (const route of routes) {
    const stream = await s.events({ origin: 'https://evil.example', 'sec-fetch-site': 'same-site' }, route);
    assert.equal(stream.status, 403, route); stream.controller.abort();
  }
  if (cloud) { const anonymous = s.client(); const stream = await anonymous.events({}, '/API/TASKS/EVENTS/'); assert.equal(stream.status, 401); stream.controller.abort(); }
});

test('wallet ledger version advances only for committed grant/freeze/release/settle and survives restart', async t => {
  const s = await setup(t); const store = s.app.locals.store;
  assert.equal(typeof store.walletVersion, 'function');
  const initial = store.walletVersion(); assert.equal(initial, 1);
  const template = store.list('task')[0]; const first = { ...template, id: 'version-first', status: 'running' };
  store.createTask(first); const frozen = store.walletVersion(); assert.equal(frozen, initial + 1);
  store.put('task', { ...first, updatedAt: new Date().toISOString() }); assert.equal(store.walletVersion(), frozen);
  store.finish({ ...first, status: 'failed' }, false); const released = store.walletVersion(); assert.equal(released, frozen + 1);
  store.finish({ ...first, status: 'failed' }, false); assert.equal(store.walletVersion(), released);
  const second = { ...template, id: 'version-second', status: 'running' }; store.createTask(second); assert.equal(store.walletVersion(), released + 1);
  store.finish({ ...second, status: 'completed' }, true); const settled = store.walletVersion(); assert.equal(settled, released + 2);
  assert.deepEqual(store.walletSnapshot(), { wallet: { balance: 480, frozen: 0, spent: 20 }, walletVersion: settled });
  assert.throws(() => store.atomic(() => { store.transaction('freeze', 20, 'rolled-back-version', '测试回滚'); throw new Error('rollback'); }));
  assert.equal(store.walletVersion(), settled);
  await s.restart(); assert.equal(s.app.locals.store.walletVersion(), settled);
  assert.equal((await s.api('/api/wallet')).walletVersion, settled);
});

for (const cloud of [false, true]) test(`${cloud ? 'cloud' : 'local'} wallet responses share a top-level ledger version and preserve the legacy Wallet shape`, async t => {
  const s = await setup(t, {}, cloud); if (cloud) await register(s, 'wallet_versions');
  const b = await s.api('/api/bootstrap');
  assert.ok(Number.isSafeInteger(b.walletVersion) && b.walletVersion >= 1);
  assert.equal((await s.api('/api/runtime')).capabilities.walletVersion, true);
  const check = (response, version) => {
    assert.equal(response.status >= 200 && response.status < 300, true, response.error);
    assert.equal(response.walletVersion, version);
    assert.deepEqual(Object.keys(response.wallet).sort(), ['balance', 'frozen', 'spent']);
  };
  check(await s.api('/api/wallet'), b.walletVersion); check(await s.api('/api/tasks/summary'), b.walletVersion);
  const c = await s.api('/api/tasks', 'POST', input(b.datasets[0].id, { clientRequestId: 'wallet-version-create' })); const frozen = b.walletVersion + 1; check(c, frozen);
  check(await s.api('/api/tasks', 'POST', input(b.datasets[0].id, { clientRequestId: 'wallet-version-create' })), frozen);
  check(await waitFor(s.api, c.task.id, 'awaiting_approval', 'plan'), frozen);
  check(await s.api(`/api/tasks/${c.task.id}/skip`, 'POST', { stepId: 'retention' }), frozen);
  await s.api(`/api/tasks/${c.task.id}/message`, 'POST', { message: '只修改任务背景，不修改钱包' });
  check(await s.api(`/api/tasks/${c.task.id}`), frozen);
  check(await s.api(`/api/tasks/${c.task.id}/approve`, 'POST', { stepId: 'plan' }), frozen);
  check(await waitFor(s.api, c.task.id, 'awaiting_approval', 'report'), frozen);
  check(await s.api(`/api/tasks/${c.task.id}/approve`, 'POST', { stepId: 'report' }), frozen);
  const completed = await waitFor(s.api, c.task.id, 'completed'); const settled = frozen + 1; check(completed, settled);
  check(await s.api('/api/bootstrap'), settled); check(await s.api('/api/tasks/summary'), settled); check(await s.api('/api/wallet'), settled);
  const second = await s.api('/api/tasks', 'POST', input(b.datasets[0].id)); check(second, settled + 1);
  await waitFor(s.api, second.task.id, 'awaiting_approval', 'plan');
  const cancelled = await s.api(`/api/tasks/${second.task.id}/cancel`, 'POST', {}); check(cancelled, settled + 2);
  check(await s.api(`/api/tasks/${second.task.id}/cancel`, 'POST', {}), cancelled.walletVersion);
  const recovered = await retry(s.api, second.task.id, { clientRequestId: 'wallet-version-retry' }); check(recovered, settled + 3);
  check(await retry(s.api, second.task.id, { clientRequestId: 'wallet-version-retry' }), recovered.walletVersion);
  check(await s.api(`/api/tasks/${recovered.task.id}/cancel`, 'POST', {}), settled + 4);
  await s.restart(); check(await s.api('/api/wallet'), settled + 4); check(await s.api('/api/bootstrap'), settled + 4);
});

for (const cloud of [false, true]) test(`${cloud ? 'cloud' : 'local'} SSE wallet version matches committed snapshots and identifies stale bootstrap wallets`, async t => {
  const s = await setup(t, { taskHeartbeatMs: 20 }, cloud); if (cloud) await register(s, 'wallet_events');
  const staleBootstrap = await s.api('/api/bootstrap'); const stream = await s.events(); const initial = await stream.next();
  assert.equal(initial.event, 'snapshot'); assert.equal(initial.data.walletVersion, staleBootstrap.walletVersion); assert.ok(Number.isSafeInteger(initial.data.walletVersion));
  const c = await s.api('/api/tasks', 'POST', input(staleBootstrap.datasets[0].id));
  let frozen;
  for (let i = 0; i < 20; i++) { const event = await stream.next(); if (event.event === 'snapshot' && event.data.wallet.frozen === 20) { frozen = event.data; break; } }
  assert.equal(frozen.walletVersion, c.walletVersion); assert.ok(frozen.walletVersion > staleBootstrap.walletVersion);
  assert.deepEqual(staleBootstrap.wallet, { balance: 500, frozen: 0, spent: 0 }); assert.deepEqual(frozen.wallet, { balance: 480, frozen: 20, spent: 0 });
  await waitFor(s.api, c.task.id, 'awaiting_approval', 'plan');
  await s.api(`/api/tasks/${c.task.id}/message`, 'POST', { message: '任务变化保持钱包版本' });
  const unchanged = await s.api('/api/tasks/summary'); assert.equal(unchanged.walletVersion, frozen.walletVersion);
  const cancelled = await s.api(`/api/tasks/${c.task.id}/cancel`, 'POST', {}); let released;
  for (let i = 0; i < 20; i++) { const event = await stream.next(); if (event.event === 'snapshot' && event.data.walletVersion === cancelled.walletVersion) { released = event.data; break; } }
  assert.equal(released.walletVersion, frozen.walletVersion + 1); assert.deepEqual(released.wallet, cancelled.wallet);
  stream.controller.abort(); await new Promise(resolve => setTimeout(resolve, 30));
  const reconnected = await s.events(); const current = await reconnected.next(); const ledger = await s.api('/api/wallet');
  assert.equal(current.data.walletVersion, ledger.walletVersion); assert.deepEqual(current.data.wallet, ledger.wallet); reconnected.controller.abort();
});
