import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const module = await import('./app.js').catch(() => ({}));
let nextPort = 23000 + Math.floor(Math.random() * 10000);

async function setup(t, options = {}) {
  assert.equal(typeof module.createApp, 'function', '必须提供 createApp');
  const dir = await mkdtemp(path.join(tmpdir(), 'dataagent-test-'));
  let app = module.createApp({ dataDir: dir, ...options });
  let server = app.listen(nextPort++, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); await rm(dir, { recursive: true, force: true }); });
  const api = async (route, method = 'GET', body, headers = {}) => {
    const res = await fetch(base + route, { method, headers: { ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
    const data = await res.json();
    return { status: res.status, ...data };
  };
  const restart = async () => {
    await new Promise(resolve => server.close(resolve)); app.locals.close();
    app = module.createApp({ dataDir: dir, ...options });
    server = app.listen(nextPort++, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  return { api, base, dir, app, restart };
}
async function waitFor(api, id, status) {
  for (let i = 0; i < 200; i++) {
    const result = await api(`/api/tasks/${id}`);
    if (result.task.status === status) return result;
    if (result.task.status === 'failed') throw new Error(result.task.error);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`任务未达到 ${status}`);
}
const newTask = (datasetId, mode = 'automatic', extra = {}) => ({ title: '增长复盘', goal: '核对留存', mode, datasetId, domain: 'game', useAI: false, ...extra });

test('bootstrap has computed demo, 28 daily points and free initial wallet', async t => {
  const { api } = await setup(t);
  const b = await api('/api/bootstrap');
  assert.equal(b.status, 200);
  assert.deepEqual(b.wallet, { balance: 500, frozen: 0, spent: 0 });
  assert.equal(b.tasks[0].status, 'completed');
  assert.equal(b.tasks[0].report.daily.length, 28);
  assert.ok(b.tasks[0].report.channels.length >= 3);
  assert.equal(b.tasks[0].report.source, 'local');
  assert.match(b.tasks[0].report.summary, /示例数据/);
  assert.equal(b.datasets[0].tables.length, 3);
  assert.equal(JSON.stringify(b).includes('apiKey'), false);
});

test('automatic workflow settles exactly once and refuses AI without a key before freeze', async t => {
  const { api } = await setup(t);
  const b = await api('/api/bootstrap');
  const bad = await api('/api/tasks', 'POST', newTask(b.datasets[0].id, 'automatic', { useAI: true }));
  assert.equal(bad.status, 400);
  assert.equal((await api('/api/wallet')).wallet.balance, 500);
  const created = await api('/api/tasks', 'POST', newTask(b.datasets[0].id));
  assert.equal(created.wallet.frozen, 20);
  const done = await waitFor(api, created.task.id, 'completed');
  assert.deepEqual(done.wallet, { balance: 480, frozen: 0, spent: 20 });
  assert.ok(done.task.steps.every(s => s.status === 'completed'));
  assert.equal(done.task.events.filter(e => e.type === 'start').length, 8);
  await api(`/api/tasks/${done.task.id}/approve`, 'POST', {});
  await api(`/api/tasks/${done.task.id}/cancel`, 'POST', {});
  assert.equal((await api('/api/wallet')).transactions.filter(x => x.type === 'settle').length, 1);
});

test('collaboration pauses twice, persists user context, and cancelling refunds once', async t => {
  const { api } = await setup(t);
  const b = await api('/api/bootstrap');
  const c = await api('/api/tasks', 'POST', newTask(b.datasets[0].id, 'collaborative'));
  let paused = await waitFor(api, c.task.id, 'awaiting_approval');
  assert.equal(paused.task.steps[paused.task.currentStep].id, 'plan');
  await api(`/api/tasks/${c.task.id}/message`, 'POST', { message: '重点关注自然渠道' });
  await api(`/api/tasks/${c.task.id}/approve`, 'POST', { message: '计划确认', stepId: 'plan' });
  await api(`/api/tasks/${c.task.id}/approve`, 'POST', { stepId: 'plan' });
  paused = await waitFor(api, c.task.id, 'awaiting_approval');
  assert.equal(paused.task.steps[paused.task.currentStep].id, 'report');
  const stale = await api(`/api/tasks/${c.task.id}/approve`, 'POST', { stepId: 'plan' });
  assert.equal(stale.task.status, 'awaiting_approval', '旧计划批准不能自动批准报告');
  assert.equal(stale.task.steps[stale.task.currentStep].id, 'report');
  await api(`/api/tasks/${c.task.id}/approve`, 'POST', { stepId: 'report' });
  const done = await waitFor(api, c.task.id, 'completed');
  assert.match(done.task.report.summary, /自然渠道/);
  const c2 = await api('/api/tasks', 'POST', newTask(b.datasets[0].id, 'collaborative'));
  await waitFor(api, c2.task.id, 'awaiting_approval');
  await api(`/api/tasks/${c2.task.id}/cancel`, 'POST', {});
  const cancelled = await api(`/api/tasks/${c2.task.id}/cancel`, 'POST', {});
  assert.deepEqual(cancelled.wallet, { balance: 480, frozen: 0, spent: 20 });
  const ledger = await api('/api/wallet');
  assert.equal(ledger.transactions.filter(x => x.taskId === c2.task.id && x.type === 'release').length, 1);
});

test('settings never expose or persist key and cross-site mutation is denied', async t => {
  const { api, dir } = await setup(t);
  const secret = 'secret-test-never-persist-123';
  let result = await api('/api/settings', 'PUT', { provider: '兼容服务', baseUrl: 'http://127.0.0.1:9876/v1', model: 'local', apiKey: secret });
  assert.equal(result.settings.hasKey, true);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal((await api('/api/settings', 'PUT', { provider: 'x', baseUrl: 'http://example.com/v1', model: 'x' })).status, 400);
  assert.equal((await api('/api/datasets/demo', 'POST', {}, { origin: 'https://evil.example' })).status, 403);
  for (const file of await readdir(dir)) assert.equal((await readFile(path.join(dir, file))).includes(Buffer.from(secret)), false);
  result = await api('/api/settings', 'PUT', { provider: '兼容服务', baseUrl: 'http://127.0.0.1:9876/v1', model: 'local', clearKey: true });
  assert.equal(result.settings.hasKey, false);
});

test('CSV chinese aliases upload, missing-table limitations and malformed files', async t => {
  const { api } = await setup(t);
  const form = new FormData();
  form.append('files', new Blob(['用户ID,注册时间,渠道\na,2026-10-01,自然\nb,2026-10-02,广告\n']), '注册用户.csv');
  const uploaded = await api('/api/datasets/upload', 'POST', form);
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.dataset.rowCount, 2);
  assert.equal(uploaded.dataset.name, '注册用户');
  assert.equal(uploaded.dataset.tables[0].type, 'users');
  const task = await api('/api/tasks', 'POST', newTask(uploaded.dataset.id));
  const done = await waitFor(api, task.task.id, 'completed');
  assert.equal(done.task.report.metrics.find(m => m.id === 'revenue').value, null);
  for (const id of ['activity', 'retention', 'monetization']) {
    const step = done.task.steps.find(s => s.id === id);
    assert.equal(step.status, 'skipped', `${id} 缺表应真实跳过`);
    assert.match(step.summary, /缺少/);
  }
  assert.equal(done.task.progress, 100);
  const bad = new FormData();
  bad.append('files', new Blob(['hello\nworld']), 'bad.csv');
  assert.equal((await api('/api/datasets/upload', 'POST', bad)).status, 400);
  assert.equal((await api('/api/datasets/..%2F..%2Fsecret')).status, 400);
});

test('model receives only aggregates; provider failure refunds with redacted error', async t => {
  const { api } = await setup(t, { fetchImpl: async (_url, init) => {
    assert.match(init.body, /metrics/);
    assert.equal(init.body.includes('user_id'), false);
    assert.equal(init.body.includes('order_id'), false);
    return new Response(JSON.stringify({ error: { message: 'bad key super-secret-123' } }), { status: 401 });
  } });
  await api('/api/settings', 'PUT', { provider: 'test', baseUrl: 'https://example.test/v1', model: 'test', apiKey: 'super-secret-123' });
  const b = await api('/api/bootstrap');
  const c = await api('/api/tasks', 'POST', newTask(b.datasets[0].id, 'automatic', { useAI: true }));
  let result;
  for (let i = 0; i < 100; i++) {
    result = await api(`/api/tasks/${c.task.id}`);
    if (result.task.status === 'failed') break;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.equal(result.task.status, 'failed');
  assert.equal(result.task.error.includes('super-secret'), false);
  assert.deepEqual(result.wallet, { balance: 500, frozen: 0, spent: 0 });
});

test('process restart releases interrupted reservations and never restores the API key', async t => {
  const { api, restart } = await setup(t);
  const b = await api('/api/bootstrap');
  const c = await api('/api/tasks', 'POST', newTask(b.datasets[0].id, 'collaborative'));
  await waitFor(api, c.task.id, 'awaiting_approval');
  await api('/api/settings', 'PUT', { provider: 'test', baseUrl: 'https://example.test/v1', model: 'test', apiKey: 'restart-secret' });
  await restart();
  const result = await api(`/api/tasks/${c.task.id}`);
  assert.equal(result.task.status, 'failed');
  assert.equal(result.task.steps[0].status, 'completed');
  assert.deepEqual(result.wallet, { balance: 500, frozen: 0, spent: 0 });
  assert.equal((await api('/api/settings')).settings.hasKey, false);
  await restart();
  const ledger = await api('/api/wallet');
  assert.equal(ledger.transactions.filter(x => x.type === 'release').length, 1);
});

test('reservation balance cannot go negative and cancelling all reservations restores 500', async t => {
  const { api } = await setup(t);
  const b = await api('/api/bootstrap');
  const ids = [];
  for (let i = 0; i < 25; i++) {
    const c = await api('/api/tasks', 'POST', newTask(b.datasets[0].id, 'collaborative'));
    assert.equal(c.status, 201); ids.push(c.task.id);
  }
  const refused = await api('/api/tasks', 'POST', newTask(b.datasets[0].id, 'collaborative'));
  assert.equal(refused.status, 402);
  assert.deepEqual((await api('/api/wallet')).wallet, { balance: 0, frozen: 500, spent: 0 });
  assert.equal((await api(`/api/datasets/${b.datasets[0].id}`, 'DELETE')).status, 409);
  for (const id of ids) await api(`/api/tasks/${id}/cancel`, 'POST', {});
  assert.deepEqual((await api('/api/wallet')).wallet, { balance: 500, frozen: 0, spent: 0 });
});

test('successful model enhancement keeps deterministic metrics and reports real test usage', async t => {
  const requests = [];
  const { api } = await setup(t, { fetchImpl: async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body), authorization: init.headers.authorization });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '模型已根据聚合指标分析', findings: [{ title: '观察', detail: '需进一步验证', severity: 'neutral', evidence: '聚合指标' }], recommendations: ['补充渠道成本'] }) } }] }), { status: 200 });
  } });
  await api('/api/settings', 'PUT', { provider: 'test', baseUrl: 'https://example.test/v1', model: 'test-model', apiKey: 'memory-only-secret' });
  const tested = await api('/api/settings/test', 'POST', {});
  assert.equal(tested.ok, true);
  assert.match(tested.message, /可能计入用量/);
  assert.equal(requests[0].body.max_tokens, 8);
  const b = await api('/api/bootstrap');
  const created = await api('/api/tasks', 'POST', newTask(b.datasets[0].id, 'automatic', { useAI: true }));
  const done = await waitFor(api, created.task.id, 'completed');
  assert.equal(done.task.report.source, 'ai');
  assert.deepEqual(done.task.report.metrics, b.tasks[0].report.metrics);
  assert.equal(requests[1].url, 'https://example.test/v1/chat/completions');
  assert.equal(requests[1].authorization, 'Bearer memory-only-secret');
  const prompt = requests[1].body.messages[1].content;
  assert.equal(prompt.includes('demo_0_0'), false);
  assert.equal(prompt.includes('demo_order_'), false);
});

const aiResponse = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '固定聚合分析', findings: [{ title: '观察', detail: '需验证', severity: 'neutral', evidence: '聚合指标' }], recommendations: ['补充背景后重新分析'] }) } }] }), { status: 200 });

test('message during an in-flight model request is explicitly refused and not persisted', async t => {
  let release;
  let entered;
  const requestStarted = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { api } = await setup(t, { fetchImpl: async () => { entered(); await gate; return aiResponse(); } });
  await api('/api/settings', 'PUT', { provider: 'test', baseUrl: 'https://example.test/v1', model: 'old-model', apiKey: 'old-key-memory' });
  const b = await api('/api/bootstrap');
  const c = await api('/api/tasks', 'POST', newTask(b.datasets[0].id, 'automatic', { useAI: true }));
  await requestStarted;
  const rejected = await api(`/api/tasks/${c.task.id}/message`, 'POST', { message: '这条不能声称已经纳入模型请求' });
  release();
  assert.equal(rejected.status, 409);
  assert.match(rejected.error, /模型请求|下次分析/);
  const done = await waitFor(api, c.task.id, 'completed');
  assert.equal(done.task.messages.some(m => m.content.includes('这条不能声称')), false);
});

test('AI task snapshots initial endpoint, model and key despite later settings changes', async t => {
  const requests = [];
  const { api, dir } = await setup(t, { fetchImpl: async (url, init) => {
    requests.push({ url, model: JSON.parse(init.body).model, authorization: init.headers.authorization });
    return aiResponse();
  } });
  await api('/api/settings', 'PUT', { provider: 'old-provider', baseUrl: 'https://old.example.test/v1', model: 'old-model', apiKey: 'snapshot-old-key' });
  const b = await api('/api/bootstrap');
  const c = await api('/api/tasks', 'POST', newTask(b.datasets[0].id, 'collaborative', { useAI: true }));
  assert.equal(c.task.model, 'old-model');
  await waitFor(api, c.task.id, 'awaiting_approval');
  await api('/api/settings', 'PUT', { provider: 'new-provider', baseUrl: 'https://new.example.test/v1', model: 'new-model', apiKey: 'snapshot-new-key' });
  await api(`/api/tasks/${c.task.id}/approve`, 'POST', { stepId: 'plan' });
  await waitFor(api, c.task.id, 'awaiting_approval');
  await api('/api/settings', 'PUT', { provider: 'new-provider', baseUrl: 'https://new.example.test/v1', model: 'new-model', clearKey: true });
  await api(`/api/tasks/${c.task.id}/approve`, 'POST', { stepId: 'report' });
  const done = await waitFor(api, c.task.id, 'completed');
  assert.equal(done.task.model, 'old-model');
  assert.deepEqual(requests, [{ url: 'https://old.example.test/v1/chat/completions', model: 'old-model', authorization: 'Bearer snapshot-old-key' }]);
  for (const file of await readdir(dir)) {
    const contents = await readFile(path.join(dir, file));
    assert.equal(contents.includes(Buffer.from('snapshot-old-key')), false);
    assert.equal(contents.includes(Buffer.from('snapshot-new-key')), false);
  }
});
