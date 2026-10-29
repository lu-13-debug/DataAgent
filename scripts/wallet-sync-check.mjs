import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createCloudApp } from '../server/cloud-app.js';

const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const directory = path.resolve('artifacts', `wallet-sync-${Date.now()}`);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  for (const cloud of [false, true]) for (const delayed of ['bootstrap', 'cancel']) {
    const app = (cloud ? createCloudApp : createApp)({ dataDir: path.join(directory, `${cloud}-${delayed}`), distDir: path.resolve('dist') });
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 1450, height: 1000 }, reducedMotion: 'reduce' });
    let release;
    try {
      const request = async (route, body) => {
        const response = await context.request[body ? 'post' : 'get'](`${base}/api${route}`, body ? { headers: { origin: base }, data: body } : {});
        assert.ok(response.ok(), `${route}: ${response.status()}`); return response.json();
      };
      if (cloud) await request('/auth/register', { username: 'wallet_sync', displayName: '余额同步验收', password: 'Design-QA-2026!' });
      const boot = await request('/bootstrap');
      const input = { title: '余额同步 A', goal: '分析最近玩家活跃', mode: 'collaborative', datasetId: boot.datasets[0].id, domain: 'game', useAI: false };
      const a = await request('/tasks', input);
      const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(base); await page.getByRole('heading', { name: '即将执行的步骤', exact: true }).waitFor();
      let captured; let captureResolve;
      const capture = new Promise(resolve => { captureResolve = resolve; });
      const pattern = delayed === 'bootstrap' ? '**/api/bootstrap' : `**/api/tasks/${a.task.id}/cancel`;
      await page.route(pattern, async route => {
        const response = await route.fetch(); captured = await response.json(); captureResolve();
        await new Promise(resolve => { release = resolve; }); await route.fulfill({ response });
      });
      if (delayed === 'bootstrap') await request(`/tasks/${a.task.id}/cancel`, {});
      else {
        await page.getByRole('button', { name: '停止分析', exact: true }).click();
        await page.getByRole('button', { name: '确认停止并释放额度', exact: true }).click();
      }
      await capture;
      const b = await request('/tasks', { ...input, title: '余额同步 B' });
      await page.locator('.recent-task').filter({ hasText: '余额同步 B' }).waitFor();
      await sleep(150);
      assert.ok(b.walletVersion > captured.walletVersion, '新冻结的账本版本应大于旧响应');
      assert.match(await page.locator('.credit-balance').innerText(), /480/);
      release(); release = undefined; await sleep(1000);
      assert.match(await page.locator('.credit-balance').innerText(), /480/, '旧响应不能覆盖已冻结余额');
      const truth = await request('/wallet'); assert.equal(truth.wallet.balance, 480); assert.equal(truth.wallet.frozen, 20);
      assert.deepEqual(errors, []);
      results.push({ runtime: cloud ? 'cloud' : 'local', delayed, staleVersion: captured.walletVersion, currentVersion: truth.walletVersion, uiBalance: 480, errors });
    } finally {
      release?.(); await context.close(); app.locals.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
  }
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ directory, results }));
} finally { await browser.close(); }
