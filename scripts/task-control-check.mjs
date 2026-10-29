import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createCloudApp } from '../server/cloud-app.js';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const directory = path.resolve('artifacts', `task-control-${Date.now()}`); await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true }); const servers = [], results = []; let page;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function hidden(value) { await page.evaluate(flag => { window.__hidden = flag; document.dispatchEvent(new Event('visibilitychange')); }, value); }
async function until(check, message, timeout = 10000) { const started = Date.now(); while (Date.now() - started < timeout) { if (await check()) return; await sleep(100); } throw new Error(message); }
try {
  for (const cloud of [true, false]) {
    const modelCalls = [];
    const app = (cloud ? createCloudApp : createApp)({ dataDir: path.join(directory, cloud ? 'cloud' : 'local'), distDir: path.resolve('dist'), modelHosts: ['api.deepseek.com'], fetchImpl: async (url, options) => {
      if (options.method === 'GET') return Response.json({ data: [{ id: 'controlled-model' }] });
      modelCalls.push({ url, body: JSON.parse(options.body) }); return Response.json({ error: { message: 'private-provider-details' } }, { status: 500 });
    } });
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); }); servers.push({ app, server });
    const base = `http://127.0.0.1:${server.address().port}`; const context = await browser.newContext({ viewport: { width: 1450, height: 1000 }, reducedMotion: 'reduce' });
    const request = async (route, body) => { const response = await context.request[body ? 'post' : 'get'](`${base}/api${route}`, body ? { headers: { origin: base }, data: body } : {}); const data = await response.json(); assert.ok(response.ok(), `${route}: ${response.status()} ${JSON.stringify(data)}`); return data; };
    if (cloud) await request('/auth/register', { username: 'monitor_user', displayName: '任务监控验收', password: 'Design-QA-2026!' });
    await context.request.put(`${base}/api/settings`, { headers: { origin: base }, data: { baseUrl: 'https://api.deepseek.com', model: 'controlled-model', apiKey: 'not-a-real-private-key' } });
    const bootstrap = await request('/bootstrap');
    const created = await request('/tasks', { title: '连接与恢复验收', goal: '分析当前数据的活跃和留存', mode: 'collaborative', datasetId: bootstrap.datasets[0].id, domain: 'game', useAI: true, clientRequestId: `monitor-${cloud}` }); const originalId = created.task.id;
    page = await context.newPage(); page.setDefaultTimeout(10000); const requests = [], errors = [];
    await page.addInitScript(allow => {
      window.__hidden = false; Object.defineProperty(document, 'hidden', { get: () => window.__hidden, configurable: true }); window.__notifications = []; window.__permissionRequests = 0;
      class TestNotification { static permission = 'default'; static async requestPermission() { window.__permissionRequests++; TestNotification.permission = allow ? 'granted' : 'denied'; return TestNotification.permission; } constructor(title, options) { this.title = title; this.options = options; window.__notifications.push(this); } close() { this.closed = true; this.onclose?.(); } }
      Object.defineProperty(window, 'Notification', { value: TestNotification, configurable: true });
    }, cloud);
    page.on('request', req => requests.push({ method: req.method(), path: new URL(req.url()).pathname, time: Date.now() })); page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.getByRole('heading', { name: '即将执行的步骤', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__permissionRequests), 0);
    await page.getByRole('button', { name: '开启任务完成通知', exact: true }).click(); assert.equal(await page.evaluate(() => window.__permissionRequests), 1);
    await page.getByRole('button', { name: '跳过商业化分析', exact: true }).click(); await page.getByRole('button', { name: '确认跳过', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await sleep(3500); assert.equal(requests.filter(req => req.path === '/api/bootstrap').length, 1, '等待期间不重复拉全量bootstrap');
    const disconnectedAt = Date.now(); await context.setOffline(true);
    await page.locator('.connection-label').getByText('连接中断，正在重连', { exact: true }).waitFor({ timeout: 10000 }); const disconnectedAfter = Date.now() - disconnectedAt;
    assert.ok(disconnectedAfter <= 10000); await sleep(1200); await context.setOffline(false);
    await page.locator('.connection-label').getByText(cloud ? '云端服务已连接' : '本地服务已连接', { exact: true }).waitFor();
    assert.equal((await request(`/tasks/${originalId}`)).task.status, 'awaiting_approval');
    await hidden(true); const hiddenAt = Date.now(); await sleep(1200);
    await request(`/tasks/${originalId}/approve`, { stepId: 'plan' });
    await until(async () => (await request(`/tasks/${originalId}`)).task.steps.some(step => step.id === 'report' && step.status === 'awaiting_approval'), '未到报告确认');
    await request(`/tasks/${originalId}/approve`, { stepId: 'report' });
    await until(async () => (await request(`/tasks/${originalId}`)).task.status === 'failed', '受控模型未失败');
    await until(async () => cloud ? await page.evaluate(() => window.__notifications.length === 1) : (await page.title()).includes('分析未完成'), '后台完成没有通知/标题提示');
    assert.equal(requests.filter(req => req.time > hiddenAt + 200 && /^\/api\/tasks\/[^/]+$/.test(req.path) && req.method === 'GET').length, 0, '隐藏时暂停详情轮询');
    assert.equal(requests.filter(req => req.time > hiddenAt + 200 && req.path === '/api/tasks/summary' && req.method === 'GET').length, 0, '隐藏时暂停摘要轮询');
    assert.ok(requests.filter(req => req.path === '/api/bootstrap').length <= 2, '终态仅校准一次');
    const original = (await request(`/tasks/${originalId}`)).task; assert.equal(original.error.includes('private-provider-details'), false);
    assert.equal((await request('/wallet')).wallet.balance, 500); assert.equal(modelCalls.length, 1);
    const aggregate = JSON.parse(modelCalls[0].body.messages.find(message => message.role === 'user').content).aggregates;
    assert.equal(aggregate.metrics.find(metric => metric.id === 'revenue').value, null);
    if (cloud) await page.evaluate(() => window.__notifications[0].onclick());
    await hidden(false); await page.getByRole('heading', { name: '分析未完成，可以创建新尝试', exact: true }).waitFor();
    await page.getByRole('button', { name: '仅确定性分析重跑', exact: true }).click();
    const retry = page.getByRole('dialog', { name: '确认创建恢复尝试' }); await retry.getByLabel('执行策略', { exact: true }).selectOption('resume');
    await retry.getByRole('button', { name: '确认新建恢复尝试 · 20 额度', exact: true }).click(); await retry.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '确认并继续', exact: true }).click();
    await until(async () => (await request('/bootstrap')).tasks.some(task => task.sourceTaskId === originalId && task.status === 'completed'), '恢复未完成');
    const after = await request('/bootstrap'); const restored = after.tasks.find(task => task.sourceTaskId === originalId);
    assert.notEqual(restored.id, originalId); assert.equal(restored.useAI, false); assert.equal(after.wallet.spent, 20); assert.equal(after.wallet.balance, 480); assert.equal(after.tasks.find(task => task.id === originalId).status, 'failed'); assert.equal(modelCalls.length, 1);
    const observed = cloud ? await page.evaluate(() => window.__notifications.length) : 0;
    await context.setOffline(true); await sleep(500); await context.setOffline(false); await sleep(1500);
    if (cloud) assert.equal(await page.evaluate(() => window.__notifications.length), observed, '重连不重复通知');
    await hidden(false);
    await request('/tasks', { title: '停止确认验收', goal: '检查当前覆盖的活跃', mode: 'collaborative', datasetId: bootstrap.datasets[0].id, domain: 'game', useAI: false });
    await page.getByRole('button', { name: '关闭三步清单', exact: true }).click().catch(() => {});
    await page.locator('.recent-task').filter({ hasText: '停止确认验收' }).click();
    await page.getByRole('button', { name: '停止分析', exact: true }).click(); await page.getByRole('dialog', { name: '确认停止分析' }).waitFor();
    assert.equal((await request('/wallet')).wallet.frozen, 20);
    await page.getByRole('button', { name: '确认停止并释放额度', exact: true }).click(); await page.getByText('任务已结束，已释放 20 额度。', { exact: true }).first().waitFor();
    assert.equal((await request('/wallet')).wallet.balance, 480); assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(directory, `${cloud ? 'cloud' : 'local'}-monitor.png`) });
    results.push({ runtime: cloud ? 'cloud' : 'local', disconnectedAfter, notifications: cloud ? await page.evaluate(() => window.__notifications.length) : 'title fallback', bootstrapRequests: requests.filter(req => req.path === '/api/bootstrap').length, originalId, restoredId: restored.id, spent: 20, errors });
    await context.close();
  }
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ passed: true, results }, null, 2)); console.log(JSON.stringify({ passed: true, directory, results }));
} catch (error) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {}); await writeFile(path.join(directory, 'failure.txt'), `${error.message}\n${await page.locator('body').innerText().catch(() => '')}`); } throw error; }
finally { await browser.close(); for (const { app, server } of servers) { app.locals.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
