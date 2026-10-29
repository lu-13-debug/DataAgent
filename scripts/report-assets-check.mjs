import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createCloudApp } from '../server/cloud-app.js';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const directory = path.resolve('artifacts', `report-assets-${Date.now()}`); await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true }); const servers = [], results = []; let page;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  for (const cloud of [false, true]) {
    const app = (cloud ? createCloudApp : createApp)({ dataDir: path.join(directory, cloud ? 'cloud' : 'local'), distDir: path.resolve('dist') });
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); }); servers.push({ app, server });
    const base = `http://127.0.0.1:${server.address().port}`; const context = await browser.newContext({ viewport: { width: 1450, height: 1000 }, reducedMotion: 'reduce' });
    const request = async (route, body, method) => { const response = await context.request[method || (body ? 'post' : 'get')](`${base}/api${route}`, body ? { headers: { origin: base }, data: body } : {}); const value = await response.json(); assert.ok(response.ok(), `${route}: ${response.status()} ${JSON.stringify(value)}`); return value; };
    const credentials = { username: 'assets_a', displayName: '报告资产验收', password: 'Design-QA-2026!' };
    if (cloud) await request('/auth/register', credentials);
    const boot = await request('/bootstrap'); const sourceId = boot.datasets[0].id;
    const input = { title: '留存报告 A', goal: '分析当前玩家留存\n业务背景：10月活动', mode: 'collaborative', datasetId: sourceId, domain: 'game', useAI: false };
    async function waitTask(id, status, step) { for (let i = 0; i < 100; i++) { const { task } = await request(`/tasks/${id}`); if (task.status === status && (!step || task.steps[task.currentStep]?.id === step)) return task; if (task.status === 'failed') throw Error(task.error); await sleep(80); } throw Error(`任务未达到${status}/${step}`); }
    const a = (await request('/tasks', input)).task; await waitTask(a.id, 'awaiting_approval', 'plan');
    await request(`/tasks/${a.id}/message`, { message: '版本1.2上线，关注自然渠道。' }); await request(`/tasks/${a.id}/approve`, { stepId: 'plan' }); await waitTask(a.id, 'awaiting_approval', 'report'); await request(`/tasks/${a.id}/approve`, { stepId: 'report' }); const source = await waitTask(a.id, 'completed');
    const b = (await request('/tasks', { ...input, title: '留存报告 B', mode: 'automatic' })).task; await waitTask(b.id, 'completed');
    const uploadedUsd = await context.request.post(`${base}/api/datasets/upload`, { headers: { origin: base }, multipart: { files: { name: 'usd-payments.csv', mimeType: 'text/csv', buffer: Buffer.from('order_id,user_id,paid_at,amount,currency,status\nusd-1,usd-player,2026-10-01,5,USD,success\nusd-2,usd-player,2026-10-02,5,USD,success\n') } } }); assert.equal(uploadedUsd.status(), 201);
    const another = (await uploadedUsd.json()).dataset; const c = (await request('/tasks', { ...input, title: '不同数据报告 C', datasetId: another.id, mode: 'automatic' })).task; await waitTask(c.id, 'completed');
    page = await context.newPage(); const errors = [], creates = []; page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { if (new URL(req.url()).pathname === '/api/tasks' && req.method() === 'POST') creates.push(req.postDataJSON()); });
    const navigateReports = async () => { const menu = page.getByRole('button', { name: '打开导航', exact: true }); if (await menu.isVisible() && !await page.locator('.sidebar').evaluate(element => element.classList.contains('sidebar-open'))) await menu.click(); await page.locator('.sidebar').getByRole('button', { name: /^分析报告/ }).click(); await page.getByRole('heading', { name: '分析报告.', exact: true }).waitFor(); };
    const card = title => page.locator('.managed-report').filter({ has: page.getByRole('button', { name: title, exact: true }) });
    await page.goto(base); await page.getByRole('heading', { name: /让数据，指引下一步/ }).waitFor(); await navigateReports();
    await card(a.title).getByRole('button', { name: `收藏${a.title}`, exact: true }).click(); await card(a.title).getByRole('button', { name: `取消收藏${a.title}`, exact: true }).waitFor();
    let releaseMetadata; let metadataCaptured;
    const captured = new Promise(resolve => { metadataCaptured = resolve; }); const responseReady = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/tasks/${a.id}/metadata`));
    await page.route(`**/api/tasks/${a.id}/metadata`, async route => { const response = await route.fetch(); metadataCaptured(); await new Promise(resolve => { releaseMetadata = resolve; }); await route.fulfill({ response }); });
    await card(a.title).getByRole('button', { name: `取消收藏${a.title}`, exact: true }).click(); await captured;
    await page.locator('.sidebar').getByRole('button', { name: '分析工作台', exact: true }).click(); releaseMetadata(); await responseReady; await page.unroute(`**/api/tasks/${a.id}/metadata`); await navigateReports();
    await card(a.title).getByRole('button', { name: `收藏${a.title}`, exact: true }).waitFor({ timeout: 2000 });
    await card(a.title).getByRole('button', { name: `收藏${a.title}`, exact: true }).click(); await card(a.title).getByRole('button', { name: `取消收藏${a.title}`, exact: true }).waitFor();
    await card(a.title).getByRole('button', { name: `置顶${a.title}`, exact: true }).click(); await card(a.title).getByText('已置顶', { exact: true }).waitFor();
    assert.equal(await page.locator('.managed-report').first().locator('.report-list-main > div:first-child > button').innerText(), a.title);
    await card(a.title).getByRole('button', { name: `编辑标签${a.title}`, exact: true }).click(); const tags = page.getByRole('dialog', { name: '整理报告标签' }); await tags.getByLabel('报告标签', { exact: true }).fill('留存，版本复盘'); await tags.getByRole('button', { name: '保存标签', exact: true }).click(); await tags.waitFor({ state: 'hidden' });
    await card(a.title).getByRole('button', { name: '筛选标签留存', exact: true }).click(); assert.equal(await page.locator('.managed-report').count(), 1); await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.getByLabel('按数据源筛选报告', { exact: true }).selectOption(sourceId); assert.equal(await card(c.title).count(), 0); await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.getByText('日期、收藏和标签', { exact: true }).click(); await page.getByRole('checkbox', { name: '只看收藏', exact: true }).check(); assert.equal(await page.locator('.managed-report').count(), 1); await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.reload(); await page.getByRole('heading', { name: /让数据，指引下一步/ }).waitFor(); await navigateReports(); await card(a.title).getByRole('button', { name: `取消收藏${a.title}`, exact: true }).waitFor(); await card(a.title).getByRole('button', { name: '筛选标签留存', exact: true }).waitFor();
    await card(a.title).getByRole('checkbox', { name: `选择对比${a.title}`, exact: true }).check(); await card(b.title).getByRole('checkbox', { name: `选择对比${b.title}`, exact: true }).check(); await page.getByRole('button', { name: '对比两份报告（2/2）', exact: true }).click();
    const comparison = page.getByRole('dialog', { name: '报告对比', exact: true }); await comparison.waitFor(); assert.equal(await comparison.getByRole('heading', { name: '不可直接比较', exact: true }).count(), 0); assert.ok((await comparison.locator('.comparison-row > p').allTextContents()).some(text => text.includes('差值：0.00'))); await comparison.getByRole('button', { name: '返回报告列表', exact: true }).click();
    await card(b.title).getByRole('checkbox', { name: `选择对比${b.title}`, exact: true }).uncheck(); await card(c.title).getByRole('checkbox', { name: `选择对比${c.title}`, exact: true }).check(); await page.getByRole('button', { name: '对比两份报告（2/2）', exact: true }).click(); await comparison.getByRole('heading', { name: '不可直接比较', exact: true }).waitFor(); await comparison.getByText('数据源不同。', { exact: true }).waitFor(); assert.ok((await comparison.locator('.comparison-row > p').allTextContents()).every(text => text === '不可直接比较'));
    const incomeRow = comparison.locator('.comparison-row').filter({ has: page.getByRole('heading', { name: '成功支付收入', exact: true }) }); assert.match(await incomeRow.locator('> div').nth(0).innerText(), /元/); assert.match(await incomeRow.locator('> div').nth(1).innerText(), /10\.00 USD/); await comparison.getByRole('button', { name: '返回报告列表', exact: true }).click();
    await card(a.title).getByRole('button', { name: '基于此继续', exact: true }).click(); const wizard = page.getByRole('dialog', { name: '开始一次新的分析' }); await wizard.getByText(`基于「${a.title}」继续`, { exact: true }).waitFor(); assert.equal(await wizard.getByLabel('选择分析数据', { exact: true }).inputValue(), sourceId); assert.equal(creates.length, 0);
    await wizard.getByRole('checkbox', { name: '我已核对自动识别结果、时间范围和缺表影响', exact: true }).check(); await wizard.getByRole('button', { name: '下一步', exact: true }).click();
    assert.equal(await wizard.getByLabel('分析目标', { exact: true }).inputValue(), '分析当前玩家留存'); assert.equal(await wizard.getByLabel('业务背景', { exact: true }).inputValue(), '10月活动');
    const inheritance = wizard.getByRole('checkbox', { name: '沿用来源中的 1 条追加业务背景', exact: true }); assert.equal(await inheritance.isChecked(), true); await inheritance.uncheck(); await wizard.getByText('核对来源中追加的背景', { exact: true }).click(); await wizard.getByText('版本1.2上线，关注自然渠道。', { exact: true }).waitFor();
    await wizard.getByRole('button', { name: '下一步', exact: true }).click(); await wizard.getByRole('button', { name: /自动模式/ }).click(); await wizard.getByRole('button', { name: '下一步', exact: true }).click(); await wizard.getByText('不沿用来源中追加的背景', { exact: true }).waitFor(); assert.equal(creates.length, 0);
    await page.screenshot({ path: path.join(directory, `${cloud ? 'cloud' : 'local'}-continuation.png`) });
    const creating = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/tasks'); await wizard.getByRole('button', { name: '确认并开始分析 · 20 额度', exact: true }).click(); const continued = (await (await creating).json()).task; await wizard.waitFor({ state: 'hidden' }); await waitTask(continued.id, 'completed');
    assert.equal(creates.length, 1); assert.equal(creates[0].sourceTaskId, a.id); assert.equal(creates[0].inheritContext, false);
    const complete = (await request(`/tasks/${continued.id}`)).task; assert.equal(complete.sourceKind, 'continuation'); assert.equal(complete.messages.some(message => message.role === 'user' && message.content.includes('版本1.2')), false);
    await page.getByRole('region', { name: '报告来源与继续分析' }).getByRole('button', { name: a.title, exact: true }).click(); await page.locator('.full-report h2').waitFor(); assert.equal(await page.locator('.full-report h2').innerText(), a.title);
    assert.equal((await request(`/tasks/${a.id}`)).task.goal, source.goal); assert.equal((await request('/wallet')).wallet.spent, 80);
    await navigateReports(); await page.setViewportSize({ width: 390, height: 844 });
    const widths = await page.evaluate(() => ({ window: innerWidth, document: document.documentElement.scrollWidth })); assert.equal(widths.document, 390);
    await page.screenshot({ path: path.join(directory, `${cloud ? 'cloud' : 'local'}-reports-390.png`) });
    if (cloud) {
      await request('/auth/logout', {}); await request('/auth/register', { ...credentials, username: 'assets_b', displayName: '隔离账号B' }); await page.reload(); await page.getByRole('heading', { name: /让数据，指引下一步/ }).waitFor(); await navigateReports(); assert.equal(await card(a.title).count(), 0); assert.equal((await request('/wallet')).wallet.balance, 500);
      await request('/auth/logout', {}); await request('/auth/login', { username: credentials.username, password: credentials.password }); await page.reload(); await page.getByRole('heading', { name: /让数据，指引下一步/ }).waitFor(); await navigateReports(); await card(a.title).getByRole('button', { name: `取消收藏${a.title}`, exact: true }).waitFor();
    }
    assert.deepEqual(errors, []); results.push({ runtime: cloud ? 'cloud' : 'local', metadataPersisted: true, comparison: 'same basis only', continuationId: continued.id, spent: 80, widths, errors }); await context.close();
  }
  for (const blocked of [false, true]) {
    const app = createApp({ dataDir: path.join(directory, `legacy-${blocked}`), distDir: path.resolve('dist') });
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); }); servers.push({ app, server }); const base = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    if (blocked) await context.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw Error('storage blocked'); } }); });
    page = await context.newPage(); const errors = [], writes = []; page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { if (req.method() === 'PUT' && req.url().endsWith('/metadata')) writes.push(req.url()); });
    await page.route('**/api/runtime', async route => { const response = await route.fetch(); const runtime = await response.json(); delete runtime.capabilities.reportMetadata; delete runtime.capabilities.reportContinuation; await route.fulfill({ response, json: runtime }); });
    const report = (await (await context.request.get(`${base}/api/bootstrap`)).json()).tasks[0];
    const navigate = async () => { await page.getByRole('button', { name: '打开导航', exact: true }).click(); await page.locator('.sidebar').getByRole('button', { name: /^分析报告/ }).click(); };
    await page.goto(base); await page.getByRole('button', { name: '打开命令面板', exact: true }).waitFor(); await navigate();
    await page.getByRole('button', { name: `收藏${report.title}`, exact: true }).click(); await page.getByRole('button', { name: `取消收藏${report.title}`, exact: true }).waitFor();
    if (blocked) {
      await page.getByText('无法持久保存：整理结果仅保留本次会话', { exact: true }).waitFor();
      await page.getByRole('button', { name: '打开导航', exact: true }).click(); await page.locator('.sidebar').getByRole('button', { name: '分析工作台', exact: true }).click(); await navigate();
      await page.getByRole('button', { name: `取消收藏${report.title}`, exact: true }).waitFor(); await page.getByText('无法持久保存：整理结果仅保留本次会话', { exact: true }).waitFor();
    }
    else { await page.getByText('当前服务未支持同步，整理信息仅保存在此设备的当前账号', { exact: true }).waitFor(); await page.reload(); await page.getByRole('button', { name: '打开命令面板', exact: true }).waitFor(); await navigate(); await page.getByRole('button', { name: `取消收藏${report.title}`, exact: true }).waitFor(); }
    assert.deepEqual(writes, []); assert.equal((await (await context.request.get(`${base}/api/wallet`)).json()).wallet.spent, 0);
    await page.getByRole('button', { name: '新建相似分析', exact: true }).click(); const wizard = page.getByRole('dialog', { name: '开始一次新的分析', exact: true });
    await wizard.getByText('当前服务只预填目标、数据源与表单背景，不记录来源链路，也不沿用追加的协作消息。检查后可创建普通新任务，确认后冻结 20 额度。', { exact: true }).waitFor(); assert.equal(await wizard.getByRole('checkbox', { name: /沿用来源中的/ }).count(), 0);
    await wizard.getByRole('checkbox', { name: '我已核对自动识别结果、时间范围和缺表影响', exact: true }).check(); await wizard.getByRole('button', { name: '下一步', exact: true }).click(); assert.equal(await wizard.getByLabel('分析目标', { exact: true }).inputValue(), report.goal);
    await page.keyboard.press('Escape'); assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390); results.push({ runtime: 'legacy-local', blockedStorage: blocked, serverWrites: 0, errors }); await context.close();
  }
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ passed: true, results }, null, 2)); console.log(JSON.stringify({ passed: true, directory, results }));
} catch (error) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {}); await writeFile(path.join(directory, 'failure.txt'), `${error.message}\n${await page.locator('body').innerText().catch(() => '')}`); } throw error; }
finally { await browser.close(); for (const { app, server } of servers) { app.locals.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
