import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createApp } from './app.js';
import { createCloudApp } from './cloud-app.js';
import { analyze } from './analytics.js';
const exploreModule = await import('./report-explore.js').catch(() => ({}));
let nextPort = 23000 + Math.floor(Math.random() * 10000);

const dataset = () => ({ id: 'scope-data', name: '范围样本', source: 'upload', warnings: [], records: {
  users: [
    { user_id: 'private-old', registered_at: '2026-09-30', channel: '自然' },
    { user_id: 'private-new', registered_at: '2026-10-02', channel: '自然' },
    { user_id: 'private-other', registered_at: '2026-10-04', channel: '广告' },
    { user_id: 'private-late', registered_at: '2026-10-10', channel: '自然' },
  ],
  activity: [
    { user_id: 'private-old', event_time: '2026-10-01' },
    { user_id: 'private-new', event_time: '2026-10-03' },
    { user_id: 'private-other', event_time: '2026-10-04' },
    { user_id: 'private-unknown', event_time: '2026-10-04' },
    { user_id: 'private-new', event_time: '2026-10-09' },
    { user_id: 'private-late', event_time: '2026-10-11' },
  ],
  payments: [
    { order_id: 'private-p1', user_id: 'private-old', paid_at: '2026-10-01', amount: '1', currency: 'CNY', status: 'paid' },
    { order_id: 'private-p2', user_id: 'private-old', paid_at: '2026-10-03', amount: '2', currency: 'CNY', status: 'paid' },
    { order_id: 'private-p3', user_id: 'private-old', paid_at: '2026-10-04', amount: '4', currency: 'CNY', status: 'paid' },
    { order_id: 'private-p4', user_id: 'private-other', paid_at: '2026-10-04', amount: '100', currency: 'CNY', status: 'paid' },
    { order_id: 'private-p5', user_id: 'private-unknown', paid_at: '2026-10-04', amount: '1000', currency: 'CNY', status: 'paid' },
    { order_id: 'private-p6', user_id: 'private-late', paid_at: '2026-10-11', amount: '1', currency: 'CNY', status: 'paid' },
  ],
} });
const sourceTask = (data = dataset(), skippedSteps = []) => ({ id: 'scope-task', title: '原任务', datasetId: data.id, datasetName: data.name, goal: '原目标', status: 'completed', skippedSteps, report: { ...analyze(data, { now: '2026-10-13T00:00:00Z' }), source: 'ai', summary: '原 AI 叙述不能沿用', aiUsage: { model: 'private-model' } } });
const input = (extra = {}) => ({ start: '2026-10-02', end: '2026-10-04', channels: ['自然'], comparePrevious: false, ...extra });
const metric = (report, id) => report.metrics.find(item => item.id === id);

test('exploration returns scoped exact aggregates, explicit sample counts, and no original AI prose or raw records', () => {
  assert.equal(typeof exploreModule.computeExploration, 'function', '必须实现探索计算');
  const data = dataset(), task = sourceTask(data), before = JSON.stringify({ data, task });
  const result = exploreModule.computeExploration(data, task, input());
  assert.equal(metric(result.report, 'arppu').value, 6);
  assert.equal(result.report.source, 'local'); assert.equal(result.report.aiUsage, undefined);
  assert.equal(result.report.generatedAt, task.report.generatedAt);
  assert.equal(result.scope.timeZone, 'Asia/Shanghai'); assert.equal(result.scope.statisticsVersion, 'report-explore-v1');
  assert.deepEqual(result.scope.coverage.payments, { start: '2026-10-01', end: '2026-10-11' });
  assert.equal(result.scope.sample.payingUsers, 1); assert.equal(result.scope.sample.registeredUsers, 1);
  assert.equal(result.scope.sample.sourceRows, 16); assert.equal(result.scope.sample.selectedRows, 4);
  assert.deepEqual(result.scope.sample.selectedRowsByTable, { users: 1, activity: 1, payments: 2 });
  assert.equal(result.previous, undefined); assert.equal(result.comparison.requested, false);
  assert.match(result.report.quality.issues.join(' '), /派生|筛选/);
  assert.equal(JSON.stringify(result).includes('原 AI 叙述'), false);
  assert.equal(JSON.stringify(result).includes('private-'), false);
  assert.equal(JSON.stringify({ data, task }), before, '原任务、报告和源数据不变');
});

test('adjacent equal-length previous period is really recomputed with the same channel and per-metric comparability', () => {
  assert.equal(typeof exploreModule.computeExploration, 'function');
  const data = dataset(); const result = exploreModule.computeExploration(data, sourceTask(data), input({ start: '2026-10-04', end: '2026-10-06', comparePrevious: true }));
  assert.deepEqual(result.comparison.previousRange, { start: '2026-10-01', end: '2026-10-03' });
  assert.deepEqual(result.previous.daily.map(day => day.date), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(result.previousScope.channels, result.scope.channels);
  const revenue = result.comparison.metrics.find(item => item.id === 'revenue');
  assert.deepEqual(revenue, { id: 'revenue', comparable: true, reason: null, current: 4, previous: 3, absoluteChange: 1, percentChange: 33.33 });
  assert.ok(result.report.metrics.every(item => item.change === null));
  assert.equal(result.comparison.metrics.find(item => item.id === 'd7_retention').comparable, false);
});

test('previous coverage shortage, immature retention and zero denominators never fabricate deltas', () => {
  assert.equal(typeof exploreModule.computeExploration, 'function');
  const data = dataset();
  const short = exploreModule.computeExploration(data, sourceTask(data), input({ start: '2026-10-01', end: '2026-10-03', comparePrevious: true }));
  const revenue = short.comparison.metrics.find(item => item.id === 'revenue');
  assert.equal(revenue.comparable, false); assert.equal(revenue.absoluteChange, null); assert.equal(revenue.percentChange, null); assert.match(revenue.reason, /覆盖/);
  assert.ok(short.previous.daily.every(day => day.revenue === null));
  const zero = exploreModule.computeExploration(data, sourceTask(data), input({ start: '2026-10-07', end: '2026-10-08', comparePrevious: true }));
  const zeroRevenue = zero.comparison.metrics.find(item => item.id === 'revenue');
  assert.equal(zeroRevenue.comparable, false); assert.equal(zeroRevenue.absoluteChange, null); assert.match(zeroRevenue.reason, /零|0/);
  const mature = exploreModule.computeExploration(data, sourceTask(data), input({ start: '2026-10-10', end: '2026-10-10', comparePrevious: true }));
  assert.equal(mature.report.retention[0].d7, null);
  assert.equal(mature.comparison.metrics.find(item => item.id === 'd7_retention').comparable, false);
});

test('partial tables and payments-only skipped branches retain source quality while all hidden results remain null', () => {
  assert.equal(typeof exploreModule.computeExploration, 'function');
  const data = dataset(); delete data.records.users; delete data.records.activity;
  const result = exploreModule.computeExploration(data, sourceTask(data, ['monetization']), input({ channels: [], comparePrevious: true }));
  assert.ok(result.report.metrics.every(item => item.value === null));
  assert.ok(result.report.daily.every(day => day.dau === null && day.newUsers === null && day.revenue === null && day.payers === null));
  assert.equal(result.report.quality.rows, 6); assert.equal(result.scope.sample.payingUsers, null); assert.equal(result.scope.sample.registeredUsers, null);
  assert.deepEqual(result.report.channels, []); assert.deepEqual(result.report.findings, []); assert.deepEqual(result.report.recommendations, []);
  assert.match(result.report.summary, /仅保留质量检查/);
  assert.throws(() => exploreModule.computeExploration(data, sourceTask(data), input()), /注册表/);
  const registration = dataset(); delete registration.records.activity; delete registration.records.payments;
  const partial = exploreModule.computeExploration(registration, sourceTask(registration), input());
  assert.equal(metric(partial.report, 'revenue').value, null); assert.equal(partial.scope.sample.payingUsers, null);
});

async function setup(t, options = {}, cloud = false) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dataagent-explore-'));
  const app = (cloud ? createCloudApp : createApp)({ dataDir: dir, serveStatic: false, ...options });
  const server = app.listen(nextPort++, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { app.locals.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const client = () => {
    let cookie = '';
    return { api: async (route, method = 'GET', body, signal) => {
      const res = await fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json', origin: base } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal });
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      return { status: res.status, ...await res.json() };
    } };
  };
  return { app, base, client, ...client() };
}
const install = app => { const data = dataset(); const task = { ...app.locals.store.list('task')[0], ...sourceTask(data) }; app.locals.store.put('dataset', data); app.locals.store.put('task', task); return task; };

test('local exploration is read-only, model-free, bounded and rejects invalid input, missing sources and unfinished reports', async t => {
  let modelCalls = 0; const s = await setup(t, { fetchImpl: async () => { modelCalls++; throw new Error('不应调用模型'); } });
  const task = install(s.app); const before = await s.api('/api/wallet'); const taskBefore = s.app.locals.store.get('task', task.id);
  assert.equal((await s.api('/api/runtime')).capabilities.reportExplore, true);
  const result = await s.api(`/api/tasks/${task.id}/explore`, 'POST', input({ comparePrevious: true }));
  assert.equal(result.status, 200, result.error); assert.equal(result.scope.sample.payingUsers, 1);
  assert.deepEqual(await s.api('/api/wallet'), before); assert.deepEqual(s.app.locals.store.get('task', task.id), taskBefore); assert.equal(modelCalls, 0);
  for (const bad of [{ start: '2026-02-30' }, { end: '2026-01-01' }, { start: '2000-01-01' }, { end: '2026-10-13' }, { channels: ['x'.repeat(101)] }, { channels: Array(51).fill('自然') }, { channels: '自然' }, { comparePrevious: 'yes' }]) {
    const response = await s.api(`/api/tasks/${task.id}/explore`, 'POST', input(bad)); assert.equal(response.status, 400, JSON.stringify(bad));
  }
  s.app.locals.store.put('task', { ...task, status: 'failed' });
  assert.equal((await s.api(`/api/tasks/${task.id}/explore`, 'POST', input())).status, 409);
  s.app.locals.store.put('task', task); s.app.locals.store.delete('dataset', task.datasetId);
  const missing = await s.api(`/api/tasks/${task.id}/explore`, 'POST', input()); assert.equal(missing.status, 404); assert.match(missing.error, /源数据|数据集/);
  assert.equal((await s.api('/api/tasks/unknown/explore', 'POST', input())).status, 404);
});

test('cloud exploration requires authentication and cannot read another account task or source', async t => {
  const s = await setup(t, {}, true), a = s.client(), b = s.client();
  assert.equal((await s.api('/api/tasks/unknown/explore', 'POST', input())).status, 401);
  const register = (client, username) => client.api('/api/auth/register', 'POST', { username, displayName: username, password: 'account-password-2026' });
  await register(a, 'explore_a'); await register(b, 'explore_b');
  const boot = await a.api('/api/bootstrap'); const task = boot.tasks[0]; const firstDay = task.report.daily[0].date;
  const result = await a.api(`/api/tasks/${task.id}/explore`, 'POST', { start: firstDay, end: firstDay });
  assert.equal(result.status, 200, result.error);
  assert.equal((await b.api(`/api/tasks/${task.id}/explore`, 'POST', { start: firstDay, end: firstDay })).status, 404);
  await a.api('/api/auth/logout', 'POST', {});
  assert.equal((await a.api(`/api/tasks/${task.id}/explore`, 'POST', { start: firstDay, end: firstDay })).status, 401);
});

test('worker concurrency, cancellation and close terminate real workers and clean job slots', async () => {
  assert.equal(typeof exploreModule.ReportExplorer, 'function', '必须提供有界 worker 管理器');
  const workers = [];
  const explorer = new exploreModule.ReportExplorer({ maxConcurrent: 1, workerFactory: () => { const worker = new Worker('setInterval(() => {}, 1000)', { eval: true }); workers.push(worker); return worker; } });
  const data = dataset(), task = sourceTask(data), controller = new AbortController();
  const pending = explorer.run(data, task, input(), { signal: controller.signal });
  assert.equal(explorer.size, 1);
  await assert.rejects(explorer.run(data, task, input()), error => error.status === 429);
  controller.abort(); await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(explorer.size, 0); assert.equal(workers[0].threadId, -1);
  const second = explorer.run(data, task, input()); const closed = assert.rejects(second, /关闭|取消/);
  explorer.close(); await closed;
  assert.equal(explorer.size, 0); assert.equal(workers[1].threadId, -1);
  await assert.rejects(explorer.run(data, task, input()), error => error.status === 503);
});

const waitUntil = async condition => {
  for (let i = 0; i < 300; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('异步状态未按时到达');
};

test('request cancellation and service close release workers, busy state and concurrency without blocking SSE heartbeats', async t => {
  const workers = [], payloads = [];
  const s = await setup(t, { maxReportExplorations: 1, taskHeartbeatMs: 20, reportExploreWorkerFactory: payload => {
    payloads.push(payload); const worker = new Worker('setInterval(() => {}, 1000)', { eval: true }); workers.push(worker); return worker;
  } });
  const task = install(s.app); const controller = new AbortController();
  const pending = s.api(`/api/tasks/${task.id}/explore`, 'POST', input(), controller.signal); const cancelled = assert.rejects(pending, error => error.name === 'AbortError');
  await waitUntil(() => s.app.locals.explorer.size === 1); assert.equal(s.app.locals.isBusy(), true);
  const limit = await s.api(`/api/tasks/${task.id}/explore`, 'POST', input()); assert.equal(limit.status, 429);
  const streamController = new AbortController();
  const stream = await fetch(s.base + '/api/tasks/events', { signal: streamController.signal });
  const reader = stream.body.getReader(); let events = '';
  while (!events.includes('event: heartbeat')) { const chunk = await reader.read(); events += new TextDecoder().decode(chunk.value); }
  streamController.abort(); controller.abort(); await cancelled;
  await waitUntil(() => s.app.locals.explorer.size === 0 && !s.app.locals.isBusy()); assert.equal(workers[0].threadId, -1);
  assert.deepEqual(Object.keys(payloads[0].task.report), ['generatedAt']);
  assert.equal(JSON.stringify(payloads).includes('private-model'), false); assert.equal(JSON.stringify(payloads).includes('apiKey'), false);
  const next = s.api(`/api/tasks/${task.id}/explore`, 'POST', input());
  await waitUntil(() => s.app.locals.explorer.size === 1); s.app.locals.close();
  assert.equal((await next).status, 503); await waitUntil(() => s.app.locals.explorer.size === 0); assert.equal(workers[1].threadId, -1);
});

test('corrupt source errors do not expose private player or order identifiers and retention/insight masks persist', async t => {
  const s = await setup(t); const task = install(s.app); const data = dataset();
  data.records.payments.push({ ...data.records.payments[0], user_id: 'private-conflicting-player', amount: '999' });
  s.app.locals.store.put('dataset', data);
  const response = await s.api(`/api/tasks/${task.id}/explore`, 'POST', input());
  assert.equal(response.status, 409); assert.equal(JSON.stringify(response).includes('private-'), false);
  const clean = dataset();
  const masked = exploreModule.computeExploration(clean, sourceTask(clean, ['retention', 'insights']), input({ comparePrevious: true }));
  assert.equal(metric(masked.report, 'd1_retention').value, null); assert.equal(metric(masked.report, 'revenue').value, 6);
  assert.deepEqual(masked.report.retention, []); assert.deepEqual(masked.report.findings, []); assert.deepEqual(masked.report.recommendations, []);
  assert.deepEqual(masked.previous.findings, []); assert.deepEqual(masked.previous.retention, []);
  assert.equal(masked.comparison.metrics.find(item => item.id === 'd1_retention').comparable, false);
});

test('cloud worker limits are per account and client abort frees only that account exploration', async t => {
  const workers = [];
  const s = await setup(t, { maxReportExplorations: 1, reportExploreWorkerFactory: () => { const worker = new Worker('setInterval(() => {}, 1000)', { eval: true }); workers.push(worker); return worker; } }, true);
  const a = s.client(), b = s.client();
  const register = (client, username) => client.api('/api/auth/register', 'POST', { username, displayName: username, password: 'account-password-2026' });
  await register(a, 'worker_a'); await register(b, 'worker_b');
  const aTask = (await a.api('/api/bootstrap')).tasks[0], bTask = (await b.api('/api/bootstrap')).tasks[0];
  const aController = new AbortController(), bController = new AbortController();
  const aPending = a.api(`/api/tasks/${aTask.id}/explore`, 'POST', { start: aTask.report.daily[0].date, end: aTask.report.daily[0].date }, aController.signal); const aCancelled = assert.rejects(aPending, error => error.name === 'AbortError');
  await waitUntil(() => workers.length === 1);
  assert.equal((await a.api(`/api/tasks/${aTask.id}/explore`, 'POST', { start: aTask.report.daily[0].date, end: aTask.report.daily[0].date })).status, 429);
  const bPending = b.api(`/api/tasks/${bTask.id}/explore`, 'POST', { start: bTask.report.daily[0].date, end: bTask.report.daily[0].date }, bController.signal); const bCancelled = assert.rejects(bPending, error => error.name === 'AbortError');
  await waitUntil(() => workers.length === 2); aController.abort(); await aCancelled;
  await waitUntil(() => workers[0].threadId === -1); assert.notEqual(workers[1].threadId, -1);
  bController.abort(); await bCancelled; await waitUntil(() => workers[1].threadId === -1);
});

test('source records containing only an unrecognized table return a controlled source-unavailable conflict', () => {
  const data = dataset(); const task = sourceTask(data); data.records = { misc: [{ arbitrary: 'private-unrecognized-value' }] };
  assert.throws(() => exploreModule.computeExploration(data, task, input({ channels: [] })), error => error.status === 409 && !error.message.includes('private-'));
});

test('malformed source containers and non-array tables return sanitized 409 instead of corrupt quality counts', async t => {
  const s = await setup(t); const task = install(s.app);
  const validActivity = [{ user_id: 'private-structure-player', event_time: '2026-10-02' }];
  const malformed = [
    { users: { broken: 'private-structure-player' }, activity: validActivity },
    { payments: 'private-structure-order', activity: validActivity },
    { activity: validActivity, misc: [] },
    { users: null, activity: validActivity },
    [validActivity],
    'private-structure-records',
    null,
    { users: [], activity: [], payments: [] },
    { activity: [null] },
    { activity: [{ user_id: 'private-structure-player', event_time: 'private-invalid-time' }] },
  ];
  for (const records of malformed) {
    const data = { ...dataset(), records };
    assert.throws(() => exploreModule.computeExploration(data, task, input({ channels: [] })), error => error.status === 409 && !error.message.includes('private-'));
    s.app.locals.store.put('dataset', data);
    const result = await s.api(`/api/tasks/${task.id}/explore`, 'POST', input({ channels: [] }));
    assert.equal(result.status, 409, `损坏源结构不能返回成功或伪行数：${JSON.stringify(records)}`);
    assert.equal(JSON.stringify(result).includes('private-'), false);
    assert.equal(s.app.locals.explorer.size, 0);
  }
});

const manyChannelSource = count => ({ id: 'many-channel-source', name: '高渠道样本', source: 'upload', warnings: [], records: {
  users: [{ user_id: 'first', registered_at: '2026-10-02', channel: '期内渠道' }, ...Array.from({ length: count }, (_, index) => ({ user_id: `future-${index}`, registered_at: '2026-10-10', channel: `未来渠道-${index}` }))],
  activity: [{ user_id: 'first', event_time: '2026-10-02' }],
  payments: [{ order_id: 'first-order', user_id: 'first', paid_at: '2026-10-02', amount: '10', currency: 'CNY', status: 'paid' }],
} });
const channelRequest = { start: '2026-10-02', end: '2026-10-02', channels: [] };
const channelTask = { status: 'completed', title: '高渠道探索', skippedSteps: [], report: { generatedAt: '2026-10-04T00:00:00Z' } };

test('real 16000-channel source preserves all mapped channels without quadratic scoped grouping', () => {
  const data = manyChannelSource(16000);
  const baselineStart = performance.now();
  const original = analyze(data, { now: channelTask.report.generatedAt });
  const baselineMs = performance.now() - baselineStart;
  assert.equal(original.channels.length, 1);
  const started = performance.now();
  const scoped = analyze(data, { now: channelTask.report.generatedAt, range: channelRequest, channels: [] });
  const elapsedMs = performance.now() - started;
  assert.equal(scoped.channels.length, 16001, '完整映射中的未来注册渠道不能丢失');
  assert.equal(scoped.channels[0].name, '期内渠道'); assert.equal(scoped.channels[0].users, 1); assert.equal(scoped.channels[0].revenue, 10);
  assert.ok(scoped.channels.slice(1).every(channel => channel.users === 0 && channel.revenue === 0 && channel.d1 === null));
  assert.ok(elapsedMs < Math.max(1500, baselineMs * 12), `探索 ${Math.round(elapsedMs)}ms / 默认分析 ${Math.round(baselineMs)}ms；高渠道样本不应触发逐渠道全表扫描`);
});

test('real high-channel exploration runs in a worker while the main event loop remains responsive', async () => {
  const explorer = new exploreModule.ReportExplorer(); let heartbeats = 0;
  const data = manyChannelSource(16000); const interval = setInterval(() => { heartbeats++; }, 10);
  try {
    const result = await explorer.run(data, channelTask, channelRequest);
    assert.equal(result.report.channels.length, 16001); assert.equal(result.scope.sample.registeredUsers, 1);
    assert.ok(heartbeats >= 2, '真实高渠道计算期间主线程必须能继续调度心跳');
    assert.equal(explorer.size, 0);
  } finally { clearInterval(interval); explorer.close(); }
});

test('bounded computation deadline terminates a real stuck worker and returns actionable 503 without retrying', async t => {
  const workers = [];
  const s = await setup(t, { reportExploreTimeoutMs: 25, reportExploreWorkerFactory: () => { const worker = new Worker('setInterval(() => {}, 1000)', { eval: true }); workers.push(worker); return worker; } });
  const task = install(s.app); const before = await s.api('/api/wallet');
  let guard;
  const result = await Promise.race([s.api(`/api/tasks/${task.id}/explore`, 'POST', input()), new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('缺少计算 deadline，卡住的 worker 持续占用请求')), 1500); })]).finally(() => clearTimeout(guard));
  assert.equal(result.status, 503); assert.match(result.error, /超时.*缩小/);
  assert.equal(workers.length, 1); assert.equal(workers[0].threadId, -1); assert.equal(s.app.locals.explorer.size, 0); assert.equal(s.app.locals.isBusy(), false);
  assert.deepEqual(await s.api('/api/wallet'), before);
  const bounded = new exploreModule.ReportExplorer({ timeoutMs: 90000 }); assert.ok(bounded.timeoutMs <= 30000); bounded.close();
});
