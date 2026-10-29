import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createCloudApp } from '../server/cloud-app.js';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const directory = path.resolve('artifacts', `commands-${Date.now()}`); await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true }); const servers = [], results = []; let page;
try {
  for (const cloud of [false, true]) {
    const app = (cloud ? createCloudApp : createApp)({ dataDir: path.join(directory, cloud ? 'cloud' : 'local'), distDir: path.resolve('dist') });
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); }); servers.push({ app, server });
    const base = `http://127.0.0.1:${server.address().port}`; const context = await browser.newContext({ viewport: { width: 1450, height: 1000 }, reducedMotion: 'reduce' });
    if (cloud) { const response = await context.request.post(`${base}/api/auth/register`, { headers: { origin: base }, data: { username: 'commands_qa', displayName: '键盘验收', password: 'Design-QA-2026!' } }); assert.equal(response.status(), 201); }
    page = await context.newPage(); const errors = [], creates = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (new URL(request.url()).pathname === '/api/tasks' && request.method() === 'POST') creates.push(request.postData()); });
    await page.goto(base); await page.getByRole('button', { name: '打开命令面板', exact: true }).waitFor();
    const palette = page.getByRole('dialog', { name: '查找并执行', exact: true }); const input = palette.getByRole('combobox', { name: '搜索命令', exact: true });
    const open = async () => { await page.keyboard.press('Control+k'); await palette.waitFor(); await input.evaluate(element => new Promise(resolve => requestAnimationFrame(() => resolve(element === document.activeElement)))).then(focused => assert.equal(focused, true)); };
    await open(); assert.equal(await input.getAttribute('aria-expanded'), 'true'); assert.ok(await input.getAttribute('aria-controls'));
    for (const event of [{ key: 'Escape', isComposing: true }, { key: 'Escape', keyCode: 229 }]) {
      await input.evaluate((element, init) => element.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true })), event);
      assert.equal(await palette.isVisible(), true, '组字期间取消候选不能关闭命令面板');
    }
    const first = await input.getAttribute('aria-activedescendant'); await input.press('ArrowDown'); assert.notEqual(await input.getAttribute('aria-activedescendant'), first); await input.press('ArrowUp'); assert.equal(await input.getAttribute('aria-activedescendant'), first);
    await input.fill('找不到的命令'); await palette.getByText('没有找到匹配内容。试试“报告”“数据源”或更短的关键词。', { exact: true }).waitFor(); assert.equal(await input.getAttribute('aria-activedescendant'), null);
    await input.fill('数据源'); await input.press('Enter'); await palette.waitFor({ state: 'hidden' }); await page.getByRole('heading', { name: /^数据源\.$/ }).waitFor();
    await open(); assert.match(await palette.getByRole('option').first().innerText(), /数据源/); await input.press('n'); assert.equal(await page.getByRole('dialog', { name: '开始一次新的分析' }).count(), 0);
    await input.press('Escape'); await palette.waitFor({ state: 'hidden' });
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', isComposing: true, bubbles: true }))); assert.equal(await page.getByRole('dialog').count(), 0);
    await page.keyboard.press('n'); await page.getByRole('dialog', { name: '开始一次新的分析' }).waitFor(); await page.keyboard.press('Control+k'); assert.equal(await page.getByRole('dialog').count(), 1); await page.keyboard.press('Escape');
    await page.keyboard.press('?'); await page.getByRole('dialog', { name: '快捷键', exact: true }).waitFor(); await page.keyboard.press('Escape');
    await open(); await input.fill('复盘'); await input.press('Enter'); await page.locator('.full-report').waitFor();
    await open(); await input.fill('导出当前报告'); await input.press('Enter'); const exportOption = page.locator('.dropdown-menu').getByRole('button', { name: '下载原始 Markdown', exact: true }); await exportOption.waitFor();
    await page.waitForFunction(() => document.querySelector('.dropdown-menu button') === document.activeElement);
    assert.equal(await exportOption.evaluate(element => element === document.activeElement), true, '导出命令应把键盘焦点移到真实导出选项'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.export-button').evaluate(element => element === document.activeElement), true, '关闭菜单后焦点返回导出按钮');
    await open(); await input.fill('导出当前报告'); await input.press('Enter'); await page.waitForFunction(() => document.querySelector('.dropdown-menu button') === document.activeElement);
    await page.keyboard.press('Shift+Tab'); assert.equal(await page.getByRole('button', { name: '关闭导出菜单', exact: true }).evaluate(element => element === document.activeElement), true);
    await open(); await input.fill('导出当前报告'); await input.press('Enter'); await page.waitForFunction(() => document.querySelector('.dropdown-menu button') === document.activeElement); await page.keyboard.press('Escape');
    await open(); await input.fill('game-retention'); await input.press('Enter'); await page.getByRole('dialog', { name: '用户留存分析', exact: true }).waitFor(); await page.keyboard.press('Escape');
    await open(); await input.fill('模型与 API'); await palette.getByRole('option').click(); await page.getByRole('dialog', { name: '连接你的 AI 模型', exact: true }).waitFor(); assert.equal(await page.getByRole('dialog').count(), 1); await page.keyboard.press('Escape');
    await open(); await input.fill('下一次分析使用自动模式'); await input.press('Enter'); assert.match(await page.locator('.mode-switch .selected').innerText(), /自动模式/);
    await page.keyboard.press('n'); const wizard = page.getByRole('dialog', { name: '开始一次新的分析' });
    await wizard.getByRole('checkbox', { name: '我已核对自动识别结果、时间范围和缺表影响', exact: true }).check(); await wizard.getByRole('button', { name: '下一步', exact: true }).click(); await wizard.getByRole('button', { name: '下一步', exact: true }).click(); assert.match(await wizard.locator('.mode-option.selected').innerText(), /自动模式/); await page.keyboard.press('Escape');
    if (!cloud) {
      const sample = app.locals.store.list('task').find(task => task.status === 'completed');
      const ongoing = { ...sample, id: 'live-command-fixture', title: '后台完成命令夹具', status: 'running', report: undefined, progress: 0, currentStep: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: sample.steps.map((step, index) => ({ ...step, status: index === 0 ? 'running' : 'pending' })) };
      app.locals.store.put('task', ongoing);
      await page.locator('.recent-task').filter({ hasText: ongoing.title }).click();
      await open();
      const index = (await palette.getByRole('option').allTextContents()).findIndex(text => text.includes(sample.title)); assert.ok(index >= 0);
      for (let i = 0; i < index; i++) await input.press('ArrowDown');
      assert.equal(await palette.locator('[aria-selected="true"] strong').innerText(), sample.title);
      app.locals.store.put('task', { ...ongoing, status: 'completed', report: sample.report, progress: 100, currentStep: 7, updatedAt: new Date(Date.now() + 1000).toISOString(), steps: sample.steps });
      await page.waitForFunction(title => [...document.querySelectorAll('[role=option] strong')].some(element => element.textContent === title), ongoing.title);
      assert.equal(await palette.locator('[aria-selected="true"] strong').innerText(), sample.title, 'SSE新增命令不能改变当前选择');
      await input.press('Enter'); await page.locator('.full-report h2').getByText(sample.title, { exact: true }).waitFor(); assert.equal(await page.locator('.dropdown-menu').count(), 0);
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: '打开命令面板', exact: true }).click(); await palette.waitFor();
    const widths = await page.evaluate(() => ({ window: innerWidth, document: document.documentElement.scrollWidth, dialog: document.querySelector('[role=dialog]').scrollWidth, client: document.querySelector('[role=dialog]').clientWidth }));
    assert.equal(widths.document, 390); assert.ok(widths.dialog <= widths.client + 1);
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert.equal(await palette.evaluate(element => element.contains(document.activeElement)), true); }
    await page.screenshot({ path: path.join(directory, `${cloud ? 'cloud' : 'local'}-commands-390.png`) });
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+k'); await palette.waitFor(); await page.keyboard.press('Control+k'); await palette.waitFor({ state: 'hidden' });
    assert.deepEqual(creates, []); assert.deepEqual(errors, []); results.push({ runtime: cloud ? 'cloud' : 'local', widths, errors, chargedTasks: creates.length }); await context.close();
  }
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ passed: true, results }, null, 2)); console.log(JSON.stringify({ passed: true, directory, results }));
} catch (error) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {}); await writeFile(path.join(directory, 'failure.txt'), `${error.message}\n${await page.locator('body').innerText().catch(() => '')}`); } throw error; }
finally { await browser.close(); for (const { app, server } of servers) { app.locals.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
