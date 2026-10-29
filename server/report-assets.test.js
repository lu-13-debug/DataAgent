import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { createCloudApp } from './cloud-app.js';
import { Store } from './store.js';

const password = 'account-password-2026';
const input = (datasetId, extra = {}) => ({ title: '继续分析', goal: '本次明确输入的目标', mode: 'collaborative', domain: 'game', datasetId, useAI: false, ...extra });
async function setup(t, cloud = false, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dataagent-assets-'));
  let app, server, base;
  const start = async () => {
    app = (cloud ? createCloudApp : createApp)({ dataDir: dir, serveStatic: false, ...options });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const close = async () => { app.locals.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  await start();
  t.after(async () => { await close(); await rm(dir, { recursive: true, force: true }); });
  const client = () => {
    let cookie = '';
    return { api: async (route, method = 'GET', body) => {
      const response = await fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json', origin: base } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, ...await response.json() };
    } };
  };
  const a = client(); let account;
  if (cloud) { account = await a.api('/api/auth/register', 'POST', { username: 'assets_user', displayName: '报告整理', password }); assert.equal(account.status, 201); }
  return { ...a, dir, client, get app() { return app; }, store: () => cloud ? new Store(path.join(dir, 'users', account.user.id)) : app.locals.store, restart: async () => { await close(); await start(); } };
}
async function waitFor(api, id, status, step) {
  for (let i = 0; i < 250; i++) {
    const response = await api(`/api/tasks/${id}`);
    if (response.task?.status === status && (!step || response.task.steps[response.task.currentStep].id === step)) return response;
    if (response.task?.status === 'failed' && status !== 'failed') throw new Error(response.task.error);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`任务未达到 ${status}/${step || ''}`);
}
async function finish(api, id) {
  await waitFor(api, id, 'awaiting_approval', 'plan');
  await api(`/api/tasks/${id}/approve`, 'POST', { stepId: 'plan' });
  await waitFor(api, id, 'awaiting_approval', 'report');
  await api(`/api/tasks/${id}/approve`, 'POST', { stepId: 'report' });
  return waitFor(api, id, 'completed');
}
const withStore = (s, cloud, fn) => { const store = s.store(); try { return fn(store); } finally { if (cloud) store.close(); } };

for (const cloud of [false, true]) {
  const label = cloud ? 'cloud' : 'local';
  test(`${label} metadata has independent durable revisions and leaves task, report and wallet unchanged`, async t => {
    const s = await setup(t, cloud); const b = await s.api('/api/bootstrap'); const source = b.tasks[0];
    assert.equal(source.metadata, undefined, '旧报告无需伪造持久化元数据');
    const noChange = await s.api(`/api/tasks/${source.id}/metadata`, 'PUT', {});
    assert.equal(noChange.status, 200); assert.equal(noChange.task.metadata, undefined);
    const original = withStore(s, cloud, store => store.get('task', source.id));
    const ledger = await s.api('/api/wallet');
    const first = await s.api(`/api/tasks/${source.id}/metadata`, 'PUT', { favorite: true, tags: [' 活动 ', '', '活动', '复盘'], revision: 999, report: { summary: '不能改写' } });
    assert.equal(first.status, 200, first.error);
    assert.deepEqual(first.task.metadata, { favorite: true, pinned: false, tags: ['活动', '复盘'], revision: 1 });
    assert.equal(first.task.updatedAt, source.updatedAt);
    assert.deepEqual(first.task.report, source.report);
    const again = await s.api(`/api/tasks/${source.id}/metadata`, 'PUT', { favorite: true, tags: ['活动', '复盘'] });
    assert.deepEqual(again.task.metadata, first.task.metadata);
    const second = await s.api(`/api/tasks/${source.id}/metadata`, 'PUT', { pinned: true });
    assert.deepEqual(second.task.metadata, { favorite: true, pinned: true, tags: ['活动', '复盘'], revision: 2 });
    assert.deepEqual(withStore(s, cloud, store => store.get('task', source.id)), original, '独立实体写入不能改写任务或分析缓存');
    assert.deepEqual(await s.api('/api/wallet'), ledger);
    await s.restart();
    assert.deepEqual((await s.api(`/api/tasks/${source.id}`)).task.metadata, second.task.metadata);
    assert.deepEqual((await s.api('/api/bootstrap')).tasks.find(task => task.id === source.id).metadata, second.task.metadata);
    const third = await s.api(`/api/tasks/${source.id}/metadata`, 'PUT', { favorite: false, tags: [] });
    assert.equal(third.task.metadata.revision, 3);
    assert.deepEqual(await s.api('/api/wallet'), ledger);
  });

  test(`${label} metadata validates types and tag bounds without charging or touching originals`, async t => {
    const s = await setup(t, cloud); const b = await s.api('/api/bootstrap'); const id = b.tasks[0].id;
    const original = (await s.api(`/api/tasks/${id}`)).task; const before = await s.api('/api/wallet');
    for (const body of [null, [], { favorite: 1 }, { favorite: null }, { pinned: 'yes' }, { tags: null }, { tags: '活动' }, { tags: [1] }, { tags: ['长'.repeat(21)] }, { tags: Array.from({ length: 9 }, (_, i) => `标签${i}`) }]) {
      const r = await s.api(`/api/tasks/${id}/metadata`, 'PUT', body); assert.equal(r.status, 400, JSON.stringify(body));
    }
    const max = await s.api(`/api/tasks/${id}/metadata`, 'PUT', { tags: Array.from({ length: 8 }, (_, i) => ` ${'字'.repeat(19)}${i} `) });
    assert.equal(max.status, 200); assert.equal(max.task.metadata.tags.length, 8);
    const running = await s.api('/api/tasks', 'POST', input(b.datasets[0].id));
    assert.equal((await s.api(`/api/tasks/${running.task.id}/metadata`, 'PUT', { favorite: true })).status, 409);
    await s.api(`/api/tasks/${running.task.id}/cancel`, 'POST', {});
    assert.equal((await s.api(`/api/tasks/${running.task.id}/metadata`, 'PUT', { favorite: true })).status, 409);
    assert.equal((await s.api('/api/tasks/missing-assets/metadata', 'PUT', { favorite: true })).status, 404);
    const stored = withStore(s, cloud, store => store.get('task', id));
    assert.equal(stored.metadata, undefined); assert.deepEqual(stored.report, original.report); assert.equal(stored.updatedAt, original.updatedAt);
    assert.deepEqual((await s.api('/api/wallet')).wallet, before.wallet);
  });

  test(`${label} continuation copies only chosen user context and honors current inputs, source chain and settlement`, async t => {
    const s = await setup(t, cloud); const b = await s.api('/api/bootstrap'); const source = b.tasks[0];
    withStore(s, cloud, store => {
      const original = store.get('task', source.id);
      original.goal = '旧目标不会由服务器拼接'; original.model = '旧模型'; original.useAI = true;
      original.messages.push({ id: 'old-user-id', role: 'user', content: '原用户追加的活动背景', createdAt: '2026-01-01T00:00:00Z' }, { id: 'old-ai-id', role: 'assistant', content: '不能继承的旧AI结论' });
      original._analysis = { private: '不继承' }; store.put('task', original);
    });
    const original = withStore(s, cloud, store => store.get('task', source.id));
    await s.api(`/api/tasks/${source.id}/metadata`, 'PUT', { favorite: true, pinned: true, tags: ['来源标签'] });
    const other = await s.api('/api/datasets/demo', 'POST', {});
    const body = input(other.dataset.id, { sourceTaskId: source.id, clientRequestId: 'continue-once' });
    const created = await s.api('/api/tasks', 'POST', body);
    assert.equal(created.status, 201, created.error);
    assert.equal(created.task.sourceTaskId, source.id); assert.equal(created.task.sourceKind, 'continuation');
    assert.equal(created.task.datasetId, other.dataset.id); assert.equal(created.task.goal, body.goal); assert.equal(created.task.mode, body.mode);
    assert.equal(created.task.useAI, false); assert.equal(created.task.model, '本地确定性分析');
    assert.equal(created.task.report, undefined); assert.equal(created.task._analysis, undefined); assert.equal(created.task.metadata, undefined);
    const inherited = created.task.messages.filter(message => message.role === 'user');
    assert.deepEqual(inherited.map(message => message.content), ['原用户追加的活动背景']); assert.notEqual(inherited[0].id, 'old-user-id');
    assert.ok(created.task.messages.some(message => message.role === 'system' && /继承/.test(message.content)));
    assert.equal(JSON.stringify(created.task).includes('不能继承的旧AI结论'), false);
    assert.deepEqual(created.wallet, { balance: 480, frozen: 20, spent: 0 });
    const replay = await s.api('/api/tasks', 'POST', { ...body, inheritContext: true });
    assert.equal(replay.status, 200); assert.equal(replay.task.id, created.task.id); assert.equal(replay.walletVersion, created.walletVersion);
    assert.equal((await s.api('/api/tasks', 'POST', { ...body, inheritContext: false })).status, 409);
    assert.equal((await s.api('/api/tasks', 'POST', { ...body, sourceTaskId: 'other-source' })).status, 409);
    const completed = await finish(s.api, created.task.id);
    assert.deepEqual(completed.wallet, { balance: 480, frozen: 0, spent: 20 }); assert.ok(completed.walletVersion > created.walletVersion);
    assert.deepEqual(withStore(s, cloud, store => store.get('task', source.id)), original);
    const paidSource = withStore(s, cloud, store => store.get('task', created.task.id));
    const paidLedger = (await s.api('/api/wallet')).transactions.filter(transaction => transaction.taskId === created.task.id);
    const another = await s.api('/api/tasks', 'POST', input(b.datasets[0].id, { sourceTaskId: created.task.id, inheritContext: false, mode: 'automatic' }));
    assert.equal(another.task.sourceTaskId, created.task.id); assert.equal(another.task.sourceKind, 'continuation');
    assert.deepEqual(another.task.messages.filter(message => message.role === 'user'), []);
    await waitFor(s.api, another.task.id, 'completed');
    const ledger = await s.api('/api/wallet');
    assert.deepEqual(withStore(s, cloud, store => store.get('task', created.task.id)), paidSource);
    assert.deepEqual(ledger.transactions.filter(transaction => transaction.taskId === created.task.id), paidLedger);
    assert.equal(ledger.transactions.filter(transaction => transaction.taskId === created.task.id && transaction.type === 'freeze').length, 1);
    assert.equal(ledger.transactions.filter(transaction => transaction.taskId === created.task.id && transaction.type === 'settle').length, 1);
    assert.equal(ledger.transactions.filter(transaction => transaction.taskId === source.id).length, 0);
    await s.restart();
    const restored = await s.api('/api/tasks', 'POST', body); assert.equal(restored.status, 200); assert.equal(restored.task.id, created.task.id);
  });

  test(`${label} continuation validates source, current data and bounded context before any freeze`, async t => {
    const s = await setup(t, cloud); const b = await s.api('/api/bootstrap'); const source = b.tasks[0];
    const body = input(b.datasets[0].id, { sourceTaskId: source.id }); const before = await s.api('/api/wallet');
    for (const extra of [{ sourceTaskId: null }, { sourceTaskId: '' }, { sourceTaskId: 1 }, { inheritContext: null }, { inheritContext: 'yes' }]) assert.equal((await s.api('/api/tasks', 'POST', { ...body, ...extra })).status, 400);
    assert.equal((await s.api('/api/tasks', 'POST', input(b.datasets[0].id, { inheritContext: true }))).status, 400);
    assert.equal((await s.api('/api/tasks', 'POST', { ...body, sourceTaskId: 'missing-report-source' })).status, 404);
    withStore(s, cloud, store => { const original = store.get('task', source.id); store.put('task', { ...original, id: 'missing-report', report: undefined }); store.put('task', { ...original, id: 'failed-source', status: 'failed' }); });
    for (const id of ['missing-report', 'failed-source']) assert.equal((await s.api('/api/tasks', 'POST', { ...body, sourceTaskId: id })).status, 409);
    assert.equal((await s.api('/api/tasks/missing-report/metadata', 'PUT', { favorite: true })).status, 409);
    withStore(s, cloud, store => {
      const original = store.get('task', source.id); original.messages = Array.from({ length: 101 }, (_, i) => ({ id: `context-${i}`, role: 'user', content: '完整保留不能截断' })); store.put('task', original);
    });
    const oversized = await s.api('/api/tasks', 'POST', body); assert.equal(oversized.status, 400); assert.match(oversized.error, /背景|消息|上下文/);
    withStore(s, cloud, store => { const original = store.get('task', source.id); original.messages = [{ id: 'too-long', role: 'user', content: '字'.repeat(3001) }]; store.put('task', original); });
    assert.equal((await s.api('/api/tasks', 'POST', body)).status, 400);
    const explicitNoContext = await s.api('/api/tasks', 'POST', { ...body, inheritContext: false });
    assert.equal(explicitNoContext.status, 201); await s.api(`/api/tasks/${explicitNoContext.task.id}/cancel`, 'POST', {});
    withStore(s, cloud, store => { const dataset = store.get('dataset', b.datasets[0].id); dataset.records = { activity: [{ user_id: 'private', event_time: '2099-01-01' }] }; store.put('dataset', dataset); });
    assert.equal((await s.api('/api/tasks', 'POST', { ...body, inheritContext: false })).status, 400);
    const after = await s.api('/api/wallet'); assert.deepEqual(after.wallet, before.wallet); assert.equal(after.transactions.filter(transaction => transaction.type === 'freeze').length, 1);
  });
}

test('continuation validates current balance and concurrency and supports a replacement for deleted source data', async t => {
  const s = await setup(t, false, { maxConcurrentTasks: 1 }); const b = await s.api('/api/bootstrap');
  const source = b.tasks[0]; const fresh = await s.api('/api/datasets/demo', 'POST', {});
  await s.api(`/api/datasets/${source.datasetId}`, 'DELETE');
  assert.equal((await s.api('/api/tasks', 'POST', input(source.datasetId, { sourceTaskId: source.id }))).status, 404);
  const body = input(fresh.dataset.id, { sourceTaskId: source.id });
  const created = await s.api('/api/tasks', 'POST', body); assert.equal(created.status, 201);
  const before = await s.api('/api/wallet'); assert.equal((await s.api('/api/tasks', 'POST', body)).status, 429);
  assert.deepEqual(await s.api('/api/wallet'), before);
  await s.api(`/api/tasks/${created.task.id}/cancel`, 'POST', {});
  s.app.locals.store.db.prepare('UPDATE wallet SET balance=0 WHERE id=1').run();
  const empty = await s.api('/api/wallet'); assert.equal((await s.api('/api/tasks', 'POST', body)).status, 402);
  assert.deepEqual(await s.api('/api/wallet'), empty);
});

test('cloud report metadata is shared by same-account sessions, isolated between accounts and requires login', async t => {
  const s = await setup(t, true); const a = await s.api('/api/bootstrap'); const id = a.tasks[0].id;
  const same = s.client(); assert.equal((await same.api('/api/auth/login', 'POST', { username: 'assets_user', password })).status, 200);
  const other = s.client(); assert.equal((await other.api('/api/auth/register', 'POST', { username: 'other_assets', displayName: '其他账号', password })).status, 201);
  assert.equal((await s.client().api(`/api/tasks/${id}/metadata`, 'PUT', { favorite: true })).status, 401);
  assert.equal((await other.api(`/api/tasks/${id}/metadata`, 'PUT', { favorite: true })).status, 404);
  const theirs = await other.api('/api/bootstrap');
  assert.equal((await other.api('/api/tasks', 'POST', input(theirs.datasets[0].id, { sourceTaskId: id }))).status, 404);
  const changed = await same.api(`/api/tasks/${id}/metadata`, 'PUT', { pinned: true }); assert.equal(changed.status, 200);
  assert.deepEqual((await s.api(`/api/tasks/${id}`)).task.metadata, changed.task.metadata);
  assert.equal((await other.api('/api/bootstrap')).tasks.some(task => task.id === id), false);
  await s.restart(); assert.deepEqual((await same.api(`/api/tasks/${id}`)).task.metadata, changed.task.metadata);
});

test('cloud continuation uses only current session credentials, current allowlist and current model', async t => {
  const seen = [];
  const options = { modelHosts: ['allowed.example.test'], fetchImpl: async (url, init) => {
    const request = JSON.parse(init.body); seen.push({ url, key: init.headers.authorization, request });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '本次模型摘要', findings: [], recommendations: [] }) } }] }));
  } };
  const s = await setup(t, true, options); const b = await s.api('/api/bootstrap');
  const body = input(b.datasets[0].id, { sourceTaskId: b.tasks[0].id, useAI: true, mode: 'automatic' });
  await s.api('/api/settings', 'PUT', { baseUrl: 'https://allowed.example.test/v1', model: 'previous-model', apiKey: 'session-old-key' });
  const same = s.client(); await same.api('/api/auth/login', 'POST', { username: 'assets_user', password });
  const before = await same.api('/api/wallet'); assert.equal((await same.api('/api/tasks', 'POST', body)).status, 400);
  await same.api('/api/settings', 'PUT', { baseUrl: 'https://allowed.example.test/v1', model: 'current-model', apiKey: 'session-current-key' });
  const created = await same.api('/api/tasks', 'POST', body); assert.equal(created.status, 201, created.error);
  await waitFor(same.api, created.task.id, 'completed');
  assert.equal(seen.length, 1); assert.equal(seen[0].key, 'Bearer session-current-key'); assert.equal(seen[0].request.model, 'current-model');
  assert.equal(JSON.stringify(created.task).includes('session-'), false);
  assert.deepEqual(before.wallet, { balance: 500, frozen: 0, spent: 0 });
  options.modelHosts.splice(0, 1, 'different.example.test'); await s.restart();
  assert.equal((await same.api('/api/tasks', 'POST', body)).status, 400);
  assert.equal((await same.api('/api/wallet')).transactions.filter(transaction => transaction.type === 'freeze').length, 1);
});
