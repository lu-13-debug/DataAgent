import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createCloudApp } from '../server/cloud-app.js';
import { createApp } from '../server/app.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const directory = path.resolve('artifacts', `ui-clarity-${Date.now()}`);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const servers = [];
let currentPage;
const password = 'Design-QA-2026!';
async function serve(cloud) {
  const options = { dataDir: path.join(directory, cloud ? 'cloud' : 'local'), distDir: path.resolve('dist') };
  const app = cloud ? createCloudApp({ ...options, modelHosts: [] }) : createApp(options);
  const server = await new Promise((resolve, reject) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); value.once('error', reject); });
  servers.push({ app, server });
  return `http://127.0.0.1:${server.address().port}`;
}
async function authenticate(context, base, username) {
  const response = await context.request.post(`${base}/api/auth/register`, { headers: { origin: base }, data: { username, displayName: '产品体验验收', password } });
  assert.equal(response.status(), 201);
}
async function closeDialog(page) { await page.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click(); }
async function wizardMode(page, title) {
  const dialog = page.getByRole('dialog', { name: '开始一次新的分析', exact: true });
  await dialog.getByRole('checkbox', { name: '我已核对自动识别结果、时间范围和缺表影响', exact: true }).check();
  await dialog.getByRole('button', { name: '下一步', exact: true }).click();
  if (title) await dialog.getByLabel('分析名称', { exact: true }).fill(title);
  await dialog.getByRole('button', { name: '下一步', exact: true }).click();
  return dialog;
}
async function navigation(page, name) {
  const menu = page.getByRole('button', { name: '打开导航', exact: true });
  if (await menu.isVisible() && !await page.locator('.sidebar').evaluate(el => el.classList.contains('sidebar-open'))) await menu.click();
  await page.locator('.sidebar').getByRole('button', { name }).click();
}
async function focusTrap(page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true); }
}
function ratio(a, b) {
  const luminance = color => { let hex = color.trim().replace('#', ''); if (hex.length === 3) hex = [...hex].map(c => c + c).join(''); const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
  const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

try {
  for (const cloud of [true, false]) {
    const base = await serve(cloud);
    const context = await browser.newContext({ viewport: { width: 1450, height: 1000 }, reducedMotion: 'reduce' });
    if (cloud) await authenticate(context, base, 'design_a');
    const page = await context.newPage(); currentPage = page; page.setDefaultTimeout(7000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const taskRequests = []; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/tasks') taskRequests.push(request.postDataJSON()); });
    await page.goto(base);
    const checklist = page.getByRole('region', { name: '开始使用三步清单' });
    await checklist.waitFor();
    await page.getByRole('link', { name: '跳到主内容', exact: true }).focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');
    await page.getByRole('button', { name: '查看领域说明', exact: true }).first().click();
    await page.getByRole('dialog', { name: '分析领域说明', exact: true }).waitFor(); await closeDialog(page);
    await checklist.getByRole('button', { name: '用示例数据看一份报告', exact: true }).click();
    await page.getByRole('heading', { name: '运营摘要', exact: true }).waitFor();
    await page.getByText('示例数据，不代表真实业务；阅读本报告不扣额度。', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.sample-report-banner').getBoundingClientRect().top >= document.querySelector('.topbar').getBoundingClientRect().bottom);
    await page.getByRole('button', { name: '用这份数据了解协作流程', exact: true }).click();
    await page.getByRole('dialog', { name: '协作流程说明', exact: true }).waitFor();
    await focusTrap(page);
    await page.getByRole('button', { name: '新建协作分析 · 20 额度', exact: true }).click();
    await page.getByRole('dialog', { name: '开始一次新的分析', exact: true }).waitFor();
    await wizardMode(page);
    assert.equal(await page.locator('.mode-option.selected').innerText().then(text => text.includes('协作模式')), true);
    await page.locator('.wizard-cost').getByText(/本次冻结 20 额度/).waitFor(); await closeDialog(page);
    assert.equal(taskRequests.length, 0, '免费阅读与只读引导不创建收费任务');
    assert.equal((await (await context.request.get(`${base}/api/bootstrap`)).json()).wallet.balance, 500);
    await checklist.getByRole('button', { name: '选择分析数据', exact: true }).click();
    await page.getByRole('button', { name: '加载示例数据', exact: true }).waitFor();
    await page.getByRole('button', { name: '加载示例数据', exact: true }).click();
    await page.getByRole('dialog').waitFor(); await closeDialog(page);
    assert.equal(taskRequests.length, 0);
    await page.getByRole('button', { name: '查看示例报告', exact: true }).click();
    await checklist.getByRole('button', { name: '选择分析数据', exact: true }).click();
    const uploaded = page.waitForResponse(response => response.url().endsWith('/api/datasets/upload') && response.request().method() === 'POST');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'my-users.csv', mimeType: 'text/csv', buffer: Buffer.from('user_id,registered_at,channel\nplayer_a,2026-10-01T10:00:00+08:00,自然\n') });
    assert.equal((await uploaded).status(), 201);
    await page.getByRole('heading', { name: '识别结果确认', exact: true }).waitFor(); await closeDialog(page);
    await page.getByRole('button', { name: '分析工作台', exact: true }).click();
    await checklist.getByRole('button', { name: '生成第一份报告', exact: true }).click();
    const creation = page.getByRole('dialog', { name: '开始一次新的分析' });
    await wizardMode(page, '我的第一份运营分析');
    await creation.getByRole('button', { name: /协作模式/ }).click();
    await creation.getByRole('button', { name: '下一步', exact: true }).click();
    await creation.getByRole('button', { name: '确认并开始分析 · 20 额度', exact: true }).click();
    for (const confirmation of ['请确认分析范围，或先补充业务背景。', '分析结果已整理，确认后生成报告。']) {
      await page.getByText(confirmation, { exact: true }).waitFor();
      const approval = page.getByRole('button', { name: '确认并继续', exact: true });
      await approval.click();
    }
    await page.getByText('分析完成，报告已就绪', { exact: true }).waitFor();
    await checklist.waitFor({ state: 'hidden' });
    assert.equal(taskRequests.length, 1);
    let bootstrap = await (await context.request.get(`${base}/api/bootstrap`)).json();
    assert.equal(bootstrap.wallet.spent, 20);
    await page.reload(); await page.getByRole('heading', { name: '让数据，指引下一步.', exact: true }).waitFor();
    assert.equal(await checklist.count(), 0);
    await page.getByRole('button', { name: '使用指南', exact: true }).click();
    await page.getByRole('button', { name: '重看三步清单', exact: true }).click();
    await checklist.waitFor(); await checklist.getByRole('button', { name: '关闭三步清单', exact: true }).click();
    await page.reload(); await page.getByRole('button', { name: '使用指南', exact: true }).waitFor();
    assert.equal(await checklist.count(), 0);
    const stored = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('dataagent:onboarding:')).map(k => JSON.parse(localStorage.getItem(k))));
    assert.ok(stored.every(value => Object.values(value).every(item => typeof item === 'boolean')));
    if (cloud) {
      await context.request.post(`${base}/api/auth/logout`, { headers: { origin: base }, data: {} });
      await authenticate(context, base, 'design_b'); await page.reload(); await checklist.waitFor();
      assert.equal(await checklist.getByText('看示例报告，已完成', { exact: true }).count(), 0);
      await checklist.getByRole('button', { name: '关闭三步清单', exact: true }).click();
      bootstrap = await (await context.request.get(`${base}/api/bootstrap`)).json();
    }
    const cases = [
      { hosts: [], hasKey: true, balance: 500, label: cloud ? 'AI 暂未开放' : '模型已配置' },
      { hosts: ['api.deepseek.com'], hasKey: false, balance: 500, label: '未配置 API Key' },
      { hosts: ['api.deepseek.com'], hasKey: true, balance: 19, label: '模型已配置' },
    ];
    for (const scenario of cases) {
      await page.route('**/api/runtime', route => route.fulfill({ json: { mode: cloud ? 'cloud' : 'local', authRequired: cloud, serviceName: 'DataAgent', version: '1.1.0', modelHosts: scenario.hosts } }));
      await page.route('**/api/bootstrap', route => route.fulfill({ json: { ...bootstrap, settings: { ...bootstrap.settings, hasKey: scenario.hasKey }, wallet: { ...bootstrap.wallet, balance: scenario.balance } } }));
      await page.reload(); await page.locator('.model-status').filter({ hasText: scenario.label }).waitFor();
      await page.getByRole('button', { name: '新建分析', exact: true }).first().click();
      await wizardMode(page);
      if (scenario.balance < 20) { assert.equal(await page.getByRole('dialog').getByRole('button', { name: '下一步', exact: true }).isDisabled(), true); await page.getByRole('dialog').getByText(/额度不足/).waitFor(); }
      if (cloud && !scenario.hosts.length) assert.equal(await page.getByRole('dialog').locator('.wizard-ai input[type=checkbox]').isDisabled(), true);
      await closeDialog(page); await page.unroute('**/api/runtime'); await page.unroute('**/api/bootstrap');
    }
    await page.route('**/api/bootstrap', route => route.fulfill({ json: { ...bootstrap, tasks: [] } }));
    await page.reload(); await page.getByRole('heading', { name: '从第一份分析开始', exact: true }).waitFor();
    assert.equal(await page.getByText('正在把数据变成洞察', { exact: true }).count(), 0); await page.unroute('**/api/bootstrap');
    await page.route('**/api/bootstrap', route => route.fulfill({ json: { ...bootstrap, datasets: [] } }));
    await page.reload(); await page.getByRole('button', { name: '数据源', exact: true }).click();
    await page.getByRole('button', { name: '加载示例数据', exact: true }).click();
    await page.getByRole('dialog').waitFor(); await closeDialog(page);
    assert.equal(await page.locator('.dataset-card').count(), 1);
    await page.unroute('**/api/bootstrap');
    await page.reload(); await page.getByRole('button', { name: '查看全部分析', exact: true }).click();
    await page.getByRole('heading', { name: '分析报告.', exact: true }).waitFor();
    await page.getByRole('button', { name: '分析工作台', exact: true }).click();
    await page.getByRole('button', { name: '使用指南', exact: true }).click();
    await page.getByRole('button', { name: '重看三步清单', exact: true }).click();
    await checklist.getByRole('button', { name: '用示例数据看一份报告', exact: true }).click();
    const layoutResults = [];
    for (const width of [1450, 1270, 1050, 800, 600, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const layout = await page.evaluate(() => {
        const small = [], paragraphs = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode, el = node.parentElement;
          if (!node.textContent.trim() || !el || !el.getClientRects().length || el.closest('.sr-only,script,style,option')) continue;
          const style = getComputedStyle(el), rect = el.getBoundingClientRect();
          if (style.visibility === 'hidden' || rect.width <= 1 || rect.height <= 1 || rect.right < 0 || rect.left > innerWidth) continue;
          const footnote = el.closest('.chart-footnote,.chart-source,.workspace-footer,.report-signature,.recharts-cartesian-axis-tick');
          if (parseFloat(style.fontSize) < (footnote ? 10 : 11)) small.push({ text: node.textContent.slice(0, 35), size: style.fontSize });
          if (el.tagName === 'P' && !footnote && parseFloat(style.fontSize) < 13) paragraphs.push({ text: node.textContent.slice(0, 35), size: style.fontSize });
        }
        const root = getComputedStyle(document.documentElement);
        const clippedMetrics = [...document.querySelectorAll('.metric-value')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent);
        return { width: innerWidth, scroll: document.documentElement.scrollWidth, small, paragraphs, clippedMetrics, colors: Object.fromEntries(['--muted', '--faint', '--bg', '--paper'].map(k => [k, root.getPropertyValue(k).trim()])) };
      });
      assert.deepEqual(layout.small, [], JSON.stringify(layout)); assert.deepEqual(layout.paragraphs, [], JSON.stringify(layout));
      assert.deepEqual(layout.clippedMetrics, [], JSON.stringify(layout));
      assert.ok(layout.scroll <= width, JSON.stringify(layout));
      for (const fg of ['--muted', '--faint']) for (const bg of ['--bg', '--paper']) assert.ok(ratio(layout.colors[fg], layout.colors[bg]) >= 4.5);
      layoutResults.push(layout); await page.screenshot({ path: path.join(directory, `${cloud ? 'cloud' : 'local'}-${width}.png`) });
    }
    const narrowPages = [];
    for (const [label, name] of [['datasets', '数据源'], ['reports', /^分析报告/], ['skills', 'Skill 能力库'], ['wallet', '查看使用记录']]) {
      await navigation(page, name);
      const layout = await page.evaluate(() => ({
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        smallParagraphs: [...document.querySelectorAll('.page-content p')].filter(el => el.getClientRects().length && parseFloat(getComputedStyle(el).fontSize) < 13).map(el => ({ text: el.textContent.slice(0, 40), size: getComputedStyle(el).fontSize })),
      }));
      assert.ok(layout.scroll <= layout.width, `${label}: ${JSON.stringify(layout)}`);
      assert.deepEqual(layout.smallParagraphs, [], `${label}: ${JSON.stringify(layout)}`);
      if (label === 'wallet') assert.equal(await page.locator('.wallet-notice > .lucide-info').count(), 1);
      await page.screenshot({ path: path.join(directory, `${cloud ? 'cloud' : 'local'}-${label}-390.png`) });
      narrowPages.push({ page: label, ...layout });
    }
    await page.locator('.model-status').click(); await page.getByRole('dialog').waitFor(); await focusTrap(page); await closeDialog(page);
    await navigation(page, '使用指南'); await page.getByRole('dialog').waitFor(); await focusTrap(page); await closeDialog(page);
    if (cloud) {
      await navigation(page, '账号与安全');
      await page.getByRole('dialog').waitFor(); await focusTrap(page); await closeDialog(page);
    }
    await navigation(page, '分析工作台');
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.sidebar').isVisible(), false); assert.equal(await checklist.isVisible(), false);
    assert.equal(await page.locator('.full-report').isVisible(), true); assert.equal(await page.locator('.sample-report-banner').isVisible(), true);
    await page.emulateMedia({ media: 'screen' });
    assert.deepEqual(errors, []);
    results.push({ runtime: cloud ? 'cloud' : 'local', layouts: layoutResults, narrowPages, createdTasks: taskRequests.length, errors });
    await context.close();
  }
  const base = `http://127.0.0.1:${servers[1].server.address().port}`;
  const context = await browser.newContext(); const page = await context.newPage(); currentPage = page;
  const response = await context.request.get(`${base}/api/bootstrap`); const data = await response.json();
  const secret = 'sk-never-copy-this-key';
  await page.route('**/api/bootstrap', route => route.fulfill({ json: { ...data, tasks: [{ ...data.tasks[0], report: { ...data.tasks[0].report, metrics: null, summary: secret } }] } }));
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__diagnostic = text; } }, configurable: true }); });
  await page.goto(base); await page.getByRole('heading', { name: '界面暂时无法显示', exact: true }).waitFor();
  await page.getByRole('button', { name: '复制诊断信息', exact: true }).click();
  const diagnostic = await page.evaluate(() => window.__diagnostic); assert.ok(diagnostic.includes('DA_UI_RENDER_FAILED')); assert.equal(diagnostic.includes(secret), false);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('clipboard denied'); }; });
  await page.getByRole('button', { name: '复制诊断信息', exact: true }).click(); await page.getByRole('textbox', { name: '诊断信息', exact: true }).waitFor();
  await page.unroute('**/api/bootstrap'); await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await page.getByRole('button', { name: '新建分析', exact: true }).first().waitFor(); await context.close();
  const blockedStorage = await browser.newContext();
  await blockedStorage.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } }); });
  const storagePage = await blockedStorage.newPage(); currentPage = storagePage;
  await storagePage.goto(base); await storagePage.getByRole('region', { name: '开始使用三步清单' }).waitFor();
  await storagePage.getByRole('button', { name: '关闭三步清单', exact: true }).click();
  assert.equal(await storagePage.getByRole('heading', { name: '界面暂时无法显示', exact: true }).count(), 0);
  await blockedStorage.close();
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ passed: true, results, diagnostic: JSON.parse(diagnostic) }, null, 2));
  console.log(JSON.stringify({ passed: true, directory, runtimes: results.map(r => r.runtime), widths: [1450, 1270, 1050, 800, 600, 390], errorBoundary: true }));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    await writeFile(path.join(directory, 'failure.txt'), `${error.message}\n${await currentPage.locator('body').innerText().catch(() => '')}`);
  }
  throw error;
} finally {
  await browser.close();
  for (const { app, server } of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); app.locals.close(); }
}
