import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createCloudApp } from '../server/cloud-app.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const directory = path.resolve('artifacts', `model-settings-${Date.now()}`);
await mkdir(directory, { recursive: true });
const calls = []; let slowEntered, releaseSlow;
const slowStarted = new Promise(resolve => { slowEntered = resolve; });
const slowGate = new Promise(resolve => { releaseSlow = resolve; });
const app = createCloudApp({ dataDir: path.join(directory, 'data'), fetchImpl: async (url, init) => {
  const pathname = new URL(url).pathname;
  calls.push({ url, method: init.method });
  if (init.method === 'GET') {
    if (init.headers.authorization === 'Bearer invalid-key') return Response.json({}, { status: 401 });
    if (pathname.includes('/unsupported/')) return new Response('', { status: 404 });
    if (pathname.includes('/slow/')) { slowEntered(); await slowGate; return Response.json({ data: [{ id: 'stale-model' }] }); }
    if (pathname.includes('/fast/')) return Response.json({ data: [{ id: 'fresh-model' }] });
    return Response.json({ data: [{ id: 'reasoning-model', name: '推理模型' }, { id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
  }
  const body = JSON.parse(init.body);
  assert.ok(body.max_tokens >= 512);
  if (body.model === 'deepseek-flash') assert.equal(body.thinking?.type, 'disabled');
  return body.model === 'reasoning-model'
    ? Response.json({ choices: [{ finish_reason: 'length', message: { content: null, reasoning_content: 'private-chain-must-stay-private' } }] })
    : Response.json({ choices: [{ finish_reason: 'stop', message: { content: [{ type: 'text', text: 'OK' }] } }] });
} });
const server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.once('error', reject); });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1450, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).fill('model_settings_qa');
  await page.getByLabel('显示名称', { exact: true }).fill('模型设置验收');
  await page.getByLabel('密码', { exact: true }).fill('Model-Settings-2026!');
  await page.getByLabel('确认密码', { exact: true }).fill('Model-Settings-2026!');
  await page.getByRole('button', { name: '注册并进入工作台', exact: true }).click();
  await page.getByRole('button', { name: '模型与 API 设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '连接你的 AI 模型' });
  await dialog.getByLabel('API 地址', { exact: true }).fill('https://api.deepseek.com');
  await dialog.getByLabel('API Key', { exact: true }).fill('fixture-key');
  await dialog.getByRole('combobox', { name: '模型名称', exact: true }).selectOption('deepseek-flash', { timeout: 5000 });
  assert.equal(calls.filter(x => x.method === 'POST').length, 0, '自动检测不发起生成调用');
  await page.screenshot({ path: path.join(directory, 'models-detected.png'), fullPage: true });
  await dialog.getByRole('button', { name: '测试连接', exact: true }).click();
  await dialog.locator('.form-success').filter({ hasText: '模型连接成功' }).waitFor();
  await dialog.getByRole('combobox', { name: '模型名称', exact: true }).selectOption('reasoning-model');
  await dialog.getByRole('button', { name: '测试连接', exact: true }).click();
  await dialog.locator('.form-success').filter({ hasText: '推理' }).waitFor();
  assert.equal((await dialog.innerText()).includes('private-chain-must-stay-private'), false);
  await dialog.getByLabel('API Key', { exact: true }).fill('invalid-key');
  await dialog.getByText(/API Key 无效或没有读取权限/).waitFor();
  assert.equal(await dialog.isVisible(), true);
  await dialog.getByLabel('API Key', { exact: true }).fill('fixture-key');
  await dialog.getByLabel('API 地址', { exact: true }).fill('https://api.deepseek.com/slow');
  assert.equal(await dialog.getByLabel('API Key', { exact: true }).inputValue(), '');
  await dialog.getByLabel('API Key', { exact: true }).fill('fixture-key');
  await slowStarted;
  await dialog.getByLabel('API 地址', { exact: true }).fill('https://api.deepseek.com/fast');
  await dialog.getByLabel('API Key', { exact: true }).fill('fixture-key');
  await dialog.getByRole('combobox', { name: '模型名称', exact: true }).selectOption('fresh-model');
  releaseSlow();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await dialog.getByRole('combobox', { name: '模型名称', exact: true }).inputValue(), 'fresh-model');
  assert.equal(await dialog.locator('option[value="stale-model"]').count(), 0);
  await dialog.getByLabel('API 地址', { exact: true }).fill('https://api.deepseek.com/unsupported');
  await dialog.getByLabel('API Key', { exact: true }).fill('fixture-key');
  await dialog.getByText(/不支持列出模型/).waitFor();
  await dialog.getByRole('button', { name: '手动填写', exact: true }).click();
  await dialog.getByRole('textbox', { name: '模型名称', exact: true }).fill('manual-text-model');
  await dialog.getByRole('button', { name: '测试连接', exact: true }).click();
  await dialog.locator('.form-success').filter({ hasText: '模型连接成功' }).waitFor();
  await page.screenshot({ path: path.join(directory, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(directory, 'mobile.png'), fullPage: false });
  await writeFile(path.join(directory, 'layout.json'), JSON.stringify(await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== 'fixed').map(el => ({ tag: el.tagName, className: el.className?.baseVal ?? el.className, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width })).slice(0, 30) })), null, 2));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ passed: true, calls, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, directory, generationCalls: calls.filter(x => x.method === 'POST').length, errors }));
} finally { releaseSlow(); await browser.close(); await new Promise(resolve => server.close(resolve)); app.locals.close(); }
