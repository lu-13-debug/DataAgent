import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, desktopEnvironment, startCloudFixture } from './desktop-cloud-harness.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require(process.argv[2] || 'playwright');
const executablePath = path.resolve(process.argv[3] || path.join(root, 'release/win-unpacked/DataAgent.exe'));
const directory = path.join(root, 'artifacts', `desktop-check-cloud-${Date.now()}`);
const clientDirectory = path.join(directory, 'client');
await mkdir(clientDirectory, { recursive: true });
const fixture = await startCloudFixture(directory);
let app, page;
const errors = [];
const password = 'Desktop-Cloud-2026!';
const firstName = 'desktop_first';
const secondName = 'desktop_second';
const firstTitle = '桌面账号一协作验收';
const secondTitle = '桌面账号一自动验收';
const bootstrap = () => page.evaluate(async () => { const response = await fetch('/api/bootstrap'); if (!response.ok) throw new Error('工作台接口异常：' + response.status); return response.json(); });
async function register(username, displayName) {
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('显示名称', { exact: true }).fill(displayName);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '注册并进入工作台', exact: true }).click();
  await page.getByRole('heading', { name: /让数据，指引下一步/ }).waitFor();
}
async function logout() {
  await page.getByRole('button', { name: '账号与安全', exact: true }).click();
  await page.getByRole('dialog', { name: '账号与安全', exact: true }).getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('button', { name: '登录工作台', exact: true }).waitFor();
}
async function newAnalysis(title, mode, datasetId, upload = false) {
  await page.getByRole('button', { name: '新建分析', exact: true }).first().click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('分析名称', { exact: true }).fill(title);
  await modal.getByRole('button', { name: mode === 'collaborative' ? /协作模式/ : /自动模式/ }).click();
  if (upload) {
    const fileNames = ['desktop-exclusive-users.csv', 'desktop-exclusive-activity.csv', 'desktop-exclusive-payments.csv'];
    const rows = [
      'user_id,registered_at,channel\nu1,2026-10-01T10:00:00+08:00,自然渠道\nu2,2026-10-01T11:00:00+08:00,广告渠道\nu3,2026-10-02T09:00:00+08:00,自然渠道\n',
      'user_id,event_time\nu1,2026-10-01T10:01:00+08:00\nu2,2026-10-01T11:01:00+08:00\nu1,2026-10-02T09:00:00+08:00\nu3,2026-10-02T09:01:00+08:00\nu3,2026-10-03T09:01:00+08:00\n',
      'order_id,user_id,paid_at,amount,currency,status\no1,u1,2026-10-01T10:30:00+08:00,6,CNY,success\no2,u3,2026-10-02T10:30:00+08:00,12,CNY,success\n',
    ];
    const uploadedResponse = page.waitForResponse(response => response.url().endsWith('/api/datasets/upload') && response.request().method() === 'POST');
    await modal.locator('input[type=file]').setInputFiles(fileNames.map((name, index) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(rows[index], 'utf8') })));
    const response = await uploadedResponse;
    assert.equal(response.status(), 201, '真实上传应成功创建数据集');
    const uploaded = (await response.json()).dataset;
    await modal.getByLabel('选择分析数据', { exact: true }).locator(`option[value="${uploaded.id}"]`).waitFor({ state: 'attached' });
    await modal.getByLabel('选择分析数据', { exact: true }).selectOption(uploaded.id);
  } else await modal.getByLabel('选择分析数据', { exact: true }).selectOption(datasetId);
  await modal.getByRole('button', { name: '开始分析', exact: true }).click();
}
try {
  // Start at the real local connection page; the test supplies the external cloud service by hand.
  const env = desktopEnvironment('');
  app = await _electron.launch({ executablePath, args: [`--dataagent-user-data=${clientDirectory}`], env, timeout: 30000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '连接你的分析工作台', exact: true }).waitFor();
  const localIsolation = await page.evaluate(() => ({ node: typeof window.require, process: typeof window.process, bridge: Object.keys(window.dataagentConnection) }));
  assert.deepEqual(localIsolation, { node: 'undefined', process: 'undefined', bridge: ['connect'] });
  await page.getByLabel('服务地址', { exact: true }).fill('http://example.com');
  await page.getByRole('button', { name: '验证并连接', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '必须使用 HTTPS' }).waitFor();
  await page.getByLabel('服务地址', { exact: true }).fill(fixture.origin);
  const remoteWindow = app.waitForEvent('window');
  await page.getByRole('button', { name: '验证并连接', exact: true }).click();
  page = await remoteWindow;
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '登录工作台', exact: true }).waitFor();
  const remoteIsolation = await page.evaluate(() => typeof window.require === 'undefined' && typeof window.process === 'undefined' && typeof window.dataagentConnection === 'undefined');
  assert.equal(remoteIsolation, true);
  assert.deepEqual(JSON.parse(await readFile(path.join(clientDirectory, 'connection.json'), 'utf8')), { serverUrl: fixture.origin });
  const runtime = await app.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, version: app.getVersion(), preferences: BrowserWindow.getAllWindows().find(win => win.webContents.getURL().startsWith('http'))?.webContents.getLastWebPreferences() }));
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.preferences.nodeIntegration, false);
  assert.equal(runtime.preferences.contextIsolation, true);
  assert.equal(runtime.preferences.sandbox, true);
  assert.equal(runtime.preferences.webSecurity, true);
  assert.ok(!runtime.preferences.preload);
  assert.equal(await page.evaluate(async () => (await fetch('/api/bootstrap')).status), 401);
  await register(firstName, '桌面账号一');
  assert.equal((await bootstrap()).wallet.balance, 500);
  await newAnalysis(firstTitle, 'collaborative', null, true);
  await page.getByRole('button', { name: '确认并继续', exact: true }).waitFor();
  await page.getByLabel('发送给分析搭档的消息').fill('重点检查自然渠道新增和留存。');
  await page.getByRole('button', { name: '确认并继续', exact: true }).click();
  await page.getByText('分析结果已整理，确认后生成报告。', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(directory, 'collaboration.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '确认并继续', exact: true }).click();
  await page.locator('.run-status-card strong').filter({ hasText: '分析完成，报告已就绪' }).waitFor();
  await page.getByRole('tab', { name: '完整报告', exact: true }).click();
  await page.getByText('运营摘要', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(directory, 'report.png'), animations: 'disabled' });
  const completed = await bootstrap();
  const task = completed.tasks.find(item => item.title === firstTitle);
  const privateDataset = completed.datasets.find(item => item.id === task.datasetId);
  assert.equal(privateDataset.source, 'upload');
  assert.equal(task.status, 'completed');
  assert.equal(task.steps.filter(step => step.status === 'completed').length, 8);
  assert.ok(task.report.metrics.length >= 8);
  assert.equal(completed.wallet.balance, 480);
  assert.equal(completed.wallet.frozen, 0);
  const markdown = await page.evaluate(async id => (await fetch(`/api/tasks/${id}/report.md`)).text(), task.id);
  assert.match(markdown, /自然渠道/);
  await newAnalysis(secondTitle, 'automatic', privateDataset.id);
  await page.locator('.run-status-card strong').filter({ hasText: '分析完成，报告已就绪' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '确认并继续', exact: true }).count(), 0);
  assert.equal((await bootstrap()).wallet.balance, 460);
  await logout();
  await register(secondName, '桌面账号二');
  const second = await bootstrap();
  assert.equal(second.wallet.balance, 500);
  assert.equal(second.wallet.spent, 0);
  assert.equal(second.tasks.some(item => item.title === firstTitle || item.title === secondTitle), false);
  assert.equal(second.datasets.some(item => item.id === privateDataset.id), false);
  const forbidden = await page.evaluate(async ({ taskId, datasetId }) => ({ task: (await fetch(`/api/tasks/${taskId}`)).status, dataset: (await fetch(`/api/datasets/${datasetId}`)).status, report: (await fetch(`/api/tasks/${taskId}/report.md`)).status }), { taskId: task.id, datasetId: privateDataset.id });
  for (const status of Object.values(forbidden)) assert.ok([403, 404].includes(status));
  await logout();
  await page.getByLabel('用户名', { exact: true }).fill(firstName);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作台', exact: true }).click();
  await page.getByRole('heading', { name: /让数据，指引下一步/ }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: /让数据，指引下一步/ }).waitFor();
  const persisted = await bootstrap();
  assert.equal(persisted.tasks.filter(item => [firstTitle, secondTitle].includes(item.title)).length, 2);
  assert.equal(persisted.wallet.spent, 40);
  assert.deepEqual(errors, []);
  const oldSession = await page.evaluate(async () => (await fetch('/api/auth/session')).json());
  assert.equal(oldSession.user.username, firstName);
  const nextConnection = app.waitForEvent('window');
  await app.evaluate(({ Menu }) => { Menu.getApplicationMenu().items.find(item => item.label === '文件').submenu.items.find(item => item.label === '切换服务器…').click(); });
  page = await nextConnection;
  await page.getByRole('heading', { name: '连接你的分析工作台', exact: true }).waitFor();
  const cookieCount = await app.evaluate(async ({ session }, url) => (await session.defaultSession.cookies.get({ url })).length, fixture.origin);
  assert.equal(cookieCount, 0, '切换服务应清理旧服务的认证 Cookie');
  const result = { passed: true, packaged: runtime.packaged, version: runtime.version, mode: 'cloud', serverUrl: fixture.origin, registration: true, localConnection: true, remoteIsolated: remoteIsolation, collaborative: true, automatic: true, accountIsolation: true, switchClearsSession: true, wallet: persisted.wallet, errors };
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, directory }, null, 2));
} catch (error) {
  await writeFile(path.join(directory, 'failure.txt'), error.stack || String(error));
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(directory, 'failure.png'), animations: 'disabled' }).catch(() => {});
  throw error;
} finally {
  try { if (app) await app.close(); }
  finally { await fixture.close(); }
}
