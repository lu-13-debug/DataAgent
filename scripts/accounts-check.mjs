import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createCloudApp } from '../server/cloud-app.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const directory = path.resolve('artifacts', `accounts-check-${Date.now()}`);
await mkdir(directory, { recursive: true });
const calls = [];
const app = createCloudApp({
  dataDir: path.join(directory, 'server-data'), distDir: path.resolve('dist'), production: false,
  modelHosts: ['model.example.test'],
  fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const content = body.max_tokens === 8 ? 'OK' : JSON.stringify({ summary: '根据用户上传数据的聚合指标完成分析。请结合渠道投放背景验证留存与收入变化。', findings: [{ title: '核对真实上传数据', detail: '报告保留代码计算的收入与留存指标。', severity: 'neutral', evidence: '以服务端聚合指标为准。' }], recommendations: ['结合自然渠道的业务背景开展后续验证。'] });
    return Response.json({ choices: [{ message: { content } }] });
  },
});
const server = await new Promise((resolve, reject) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); value.once('error', reject); });
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const suffix = Date.now().toString(36);
const alice = { username: `qa_a_${suffix}`, displayName: '验收运营A', password: 'QA-Passphrase-2026' };
const bob = { username: `qa_b_${suffix}`, displayName: '验收运营B', password: 'QA-Passphrase-2026' };
async function register(page, user) {
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await page.locator('#auth-username').fill(user.username);
  await page.locator('#auth-display-name').fill(user.displayName);
  await page.locator('#auth-password').fill(user.password);
  await page.locator('#auth-confirm-password').fill(user.password);
  await page.getByRole('button', { name: '注册并进入工作台', exact: true }).click();
  await page.getByRole('heading', { name: /让数据，指引下一步/ }).waitFor();
}
async function accountModal(page) { await page.getByRole('button', { name: '账号与安全', exact: true }).first().click(); return page.getByRole('dialog'); }
try {
  const ac = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const a = await ac.newPage(); a.on('pageerror', error => errors.push(error.message));
  await a.goto(url);
  await a.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor();
  await a.screenshot({ path: path.join(directory, 'login.png'), animations: 'disabled', fullPage: true });
  await register(a, alice);
  assert.equal((await a.evaluate(async () => (await fetch('/api/bootstrap')).json())).wallet.balance, 500);
  const cookie = (await ac.cookies()).find(c => c.name === 'da_session');
  assert.ok(cookie?.httpOnly); assert.equal(cookie.sameSite, 'Strict');
  assert.equal(await a.evaluate(() => document.cookie.includes('da_session')), false);
  await a.getByRole('button', { name: '模型与 API 设置', exact: true }).click();
  await a.getByLabel('供应商名称', { exact: true }).fill('验收模拟供应商');
  await a.getByLabel('API 地址', { exact: true }).fill('https://model.example.test/v1');
  await a.getByLabel('模型名称', { exact: true }).fill('account-integration-test');
  await a.getByLabel('API Key', { exact: true }).fill('qa-only-not-a-real-provider-key');
  await a.getByRole('button', { name: '测试连接', exact: true }).click();
  await a.locator('.form-success').waitFor();
  await a.getByRole('button', { name: '保存设置', exact: true }).click();
  await a.getByRole('dialog').waitFor({ state: 'hidden' });
  await a.getByRole('button', { name: '数据源', exact: true }).click();
  const uploadedResponse = a.waitForResponse(r => r.url().endsWith('/api/datasets/upload') && r.request().method() === 'POST');
  await a.locator('input[type=file]').setInputFiles([
    { name: 'users.csv', mimeType: 'text/csv', buffer: Buffer.from('user_id,registered_at,channel\nplayer_a,2026-10-01T10:00:00+08:00,自然\nplayer_b,2026-10-02T10:00:00+08:00,广告\n') },
    { name: 'activity.csv', mimeType: 'text/csv', buffer: Buffer.from('user_id,event_time\nplayer_a,2026-10-01T12:00:00+08:00\nplayer_a,2026-10-02T12:00:00+08:00\nplayer_a,2026-10-03T12:00:00+08:00\nplayer_b,2026-10-02T12:00:00+08:00\nplayer_b,2026-10-03T12:00:00+08:00\n') },
    { name: 'payments.csv', mimeType: 'text/csv', buffer: Buffer.from('order_id,user_id,paid_at,amount,currency,status\np1,player_a,2026-10-01T13:00:00+08:00,10,CNY,paid\np2,player_b,2026-10-02T13:00:00+08:00,20,CNY,paid\np3,player_b,2026-10-03T13:00:00+08:00,15,CNY,paid\n') },
  ]);
  const uploadedHttp = await uploadedResponse; assert.equal(uploadedHttp.status(), 201);
  const uploaded = (await uploadedHttp.json()).dataset;
  await a.getByRole('button', { name: '新建分析', exact: true }).first().click();
  const dialog = a.getByRole('dialog');
  await dialog.getByLabel('分析名称', { exact: true }).fill('A 的真实数据分析');
  await dialog.getByLabel('选择分析数据', { exact: true }).selectOption(uploaded.id);
  await dialog.locator('textarea').fill('核对这份真实上传数据的收入、活跃和次日留存。');
  await dialog.getByRole('button', { name: /协作模式/ }).click();
  await dialog.getByRole('button', { name: '开始分析', exact: true }).click();
  await a.getByRole('button', { name: '确认并继续', exact: true }).waitFor();
  await a.getByLabel('发送给分析搭档的消息').fill('请重点关注自然渠道，这是账号验收的业务背景。');
  await a.getByRole('button', { name: '确认并继续', exact: true }).click();
  await a.getByText('分析结果已整理，确认后生成报告。', { exact: true }).waitFor();
  await a.getByRole('button', { name: '确认并继续', exact: true }).click();
  await a.locator('.run-status-card strong').filter({ hasText: '分析完成，报告已就绪' }).waitFor();
  await a.getByRole('tab', { name: '完整报告', exact: true }).click();
  await a.getByText('运营摘要', { exact: true }).waitFor();
  const ab = await a.evaluate(async () => (await fetch('/api/bootstrap')).json());
  const task = ab.tasks.find(t => t.title === 'A 的真实数据分析');
  assert.equal(task.report.source, 'ai');
  assert.equal(task.report.metrics.find(m => m.id === 'revenue').value, 45);
  assert.equal(task.report.metrics.find(m => m.id === 'd1_retention').value, 100);
  assert.equal(ab.wallet.balance, 480);
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: '下载 Markdown 报告', exact: true }).click()]);
  assert.match(download.suggestedFilename(), /\.md$/);
  await a.screenshot({ path: path.join(directory, 'alice-report.png'), animations: 'disabled', fullPage: true });
  const modelCall = calls.find(c => c.body.max_tokens !== 8);
  assert.ok(modelCall); assert.ok(modelCall.body.messages.some(m => m.content.includes('自然渠道')));
  assert.equal(JSON.stringify(modelCall.body).includes('player_a'), false);
  const bc = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const b = await bc.newPage(); b.on('pageerror', error => errors.push(error.message));
  await b.goto(url); await b.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor();
  await b.getByRole('button', { name: '创建账号', exact: true }).click();
  await b.screenshot({ path: path.join(directory, 'registration-mobile.png'), animations: 'disabled', fullPage: true });
  assert.equal(await b.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await register(b, bob);
  const bb = await b.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(bb.wallet.balance, 500); assert.equal(bb.settings.hasKey, false);
  assert.equal(bb.datasets.some(d => d.id === uploaded.id), false);
  assert.equal(bb.tasks.some(t => t.id === task.id), false);
  for (const route of [`/api/datasets/${uploaded.id}`, `/api/tasks/${task.id}`, `/api/tasks/${task.id}/report.md`]) assert.equal(await b.evaluate(async route => (await fetch(route)).status, route), 404);
  await b.setViewportSize({ width: 1500, height: 1000 });
  await b.screenshot({ path: path.join(directory, 'bob-workspace.png'), animations: 'disabled', fullPage: true });
  let account = await accountModal(b);
  await account.locator('#account-current-password').fill(bob.password);
  await account.locator('#account-new-password').fill('Changed-QA-Passphrase-2026');
  await account.locator('#account-confirm-password').fill('Changed-QA-Passphrase-2026');
  await account.getByRole('button', { name: '修改密码并重新登录', exact: true }).click();
  await b.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor();
  await b.locator('#auth-username').fill(bob.username); await b.locator('#auth-password').fill(bob.password);
  await b.getByRole('button', { name: '登录工作台', exact: true }).click();
  await b.locator('.auth-error').waitFor();
  await b.locator('#auth-password').fill('Changed-QA-Passphrase-2026');
  await b.getByRole('button', { name: '登录工作台', exact: true }).click();
  await b.getByRole('heading', { name: /让数据，指引下一步/ }).waitFor();
  assert.equal((await b.evaluate(async () => (await fetch('/api/bootstrap')).json())).wallet.balance, 500);
  await a.reload(); await a.getByRole('heading', { name: /让数据，指引下一步/ }).waitFor();
  assert.equal((await a.evaluate(async () => (await fetch('/api/bootstrap')).json())).wallet.balance, 480);
  account = await accountModal(a); await account.getByRole('button', { name: '退出登录', exact: true }).click();
  await a.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor();
  assert.equal(await a.locator('.sidebar').count(), 0);
  assert.equal(await a.evaluate(async () => (await fetch('/api/bootstrap')).status), 401);
  assert.deepEqual(errors, []);
  const result = { passed: true, accounts: 2, realCsvRows: uploaded.rowCount, aliceBalance: ab.wallet.balance, bobBalance: bb.wallet.balance, reportsIsolated: true, credentialsHttpOnly: true, changedPassword: true, provider: 'controlled test response; no paid key used', modelRequests: calls.length, errors };
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, directory }, null, 2));
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: path.join(directory, `failure-${browser.contexts().indexOf(context)}.png`), animations: 'disabled', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  app.locals.close();
}
