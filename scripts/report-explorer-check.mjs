import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { createApp } from '../server/app.js';
import { createCloudApp } from '../server/cloud-app.js';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const directory = path.resolve('artifacts', `report-explorer-${Date.now()}`); await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true }); const servers = [], results = []; let page;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const shift = (day, offset) => new Date(Date.parse(day) + offset * 86400000).toISOString().slice(0, 10);
try {
  for (const cloud of [false, true]) {
    const app = (cloud ? createCloudApp : createApp)({ dataDir: path.join(directory, cloud ? 'cloud' : 'local'), distDir: path.resolve('dist') });
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); }); servers.push({ app, server });
    const base = `http://127.0.0.1:${server.address().port}`; const context = await browser.newContext({ viewport: { width: 1450, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
    const request = async (route, body) => { const response = await context.request[body ? 'post' : 'get'](`${base}/api${route}`, body ? { headers: { origin: base }, data: body } : {}); const json = await response.json(); assert.ok(response.ok(), `${route}: ${response.status()} ${JSON.stringify(json)}`); return json; };
    if (cloud) await request('/auth/register', { username: 'explorer_qa', displayName: '精确探索验收', password: 'Design-QA-2026!' });
    const boot = await request('/bootstrap'), original = boot.tasks[0];
    const created = (await request('/tasks', { title: '第二份探索测试', goal: '分析当前玩家活跃留存与付费', datasetId: original.datasetId, domain: 'game', mode: 'automatic', useAI: false })).task;
    let second; for (let i = 0; i < 100; i++) { second = (await request(`/tasks/${created.id}`)).task; if (second.status === 'completed') break; await sleep(50); } assert.equal(second.status, 'completed');
    const baseline = await request('/wallet'); page = await context.newPage(); const errors = [], calls = [], taskCreates = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { const url = new URL(req.url()); if (req.method() === 'POST' && url.pathname.endsWith('/explore')) calls.push(req.postDataJSON()); if (req.method() === 'POST' && url.pathname === '/api/tasks') taskCreates.push(req.postDataJSON()); });
    await page.goto(base); await page.getByRole('region', { name: '报告精确探索', exact: true }).waitFor();
    const controls = page.getByRole('region', { name: '报告精确探索', exact: true }); const chart = page.getByRole('region', { name: '当前报告趋势与导出', exact: true });
    const dates = second.report.daily.map(day => day.date), start = dates[7], end = dates[13];
    async function apply(range, compare = true) {
      await controls.getByLabel('开始日期', { exact: true }).fill(range.start); await controls.getByLabel('结束日期', { exact: true }).fill(range.end); await controls.getByRole('checkbox', { name: '比较紧邻上期', exact: true }).setChecked(compare);
      const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/explore'));
      await controls.getByRole('button', { name: '应用筛选', exact: true }).click(); const response = await pending; assert.equal(response.status(), 200); const value = await response.json();
      await page.waitForFunction(period => document.querySelector('.rex-applied')?.textContent.includes(period), `${range.start} 至 ${range.end}`); return value;
    }
    let applied = await apply({ start, end }); assert.equal(applied.report.daily.length, 7); assert.equal(applied.comparison.requested, true);
    const metricText = value => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value);
    assert.equal(await page.getByRole('region', { name: '日活跃玩家', exact: true }).locator('.metric-value').innerText(), metricText(applied.report.metrics.find(metric => metric.id === 'dau').value));
    assert.match(await chart.locator('.rex-current-range').innerText(), new RegExp(start)); assert.equal(await chart.locator('svg path[stroke-dasharray]').count() > 0, true);
    await page.getByText('查看指标口径与术语', { exact: true }).click(); await page.locator('.metric-glossary dd').first().waitFor();
    const evidence = page.locator('.findings-card .evidence-text').first(); await evidence.click(); assert.equal(await evidence.getAttribute('aria-pressed'), 'true'); assert.equal(await evidence.locator('mark').count(), 1);
    await controls.locator('.rex-channel-picker > summary').click(); const channel = second.report.channels[0].name; await controls.getByRole('button', { name: channel, exact: true }).click();
    applied = await apply({ start, end }); assert.deepEqual(applied.scope.channels, [channel]); assert.ok(applied.report.channels.every(row => row.name === channel));
    async function csv(label) { const downloading = page.waitForEvent('download'); await chart.getByRole('button', { name: label, exact: true }).click(); const file = await downloading; assert.match(file.suggestedFilename(), new RegExp(`${start}_${end}`)); const output = path.join(directory, `${cloud ? 'cloud' : 'local'}-${file.suggestedFilename()}`); await file.saveAs(output); return parse(await readFile(output), { bom: true, columns: true, skip_empty_lines: true }); }
    const metrics = await csv('指标 CSV'); assert.equal(Number(metrics.find(row => row['指标'] === '成功支付收入')['数值']), applied.report.metrics.find(metric => metric.id === 'revenue').value);
    const channels = await csv('渠道 CSV'); assert.equal(channels.length, 1); assert.equal(channels[0]['注册渠道'], channel); const retention = await csv('留存 CSV'); assert.equal(retention.length, applied.report.retention.length);
    const image = page.waitForEvent('download'); await chart.getByRole('button', { name: '趋势 PNG', exact: true }).click(); const png = await image; const pngPath = path.join(directory, `${cloud ? 'cloud' : 'local'}-trend.png`); await png.saveAs(pngPath); const bytes = await readFile(pngPath); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.equal(bytes.readUInt32BE(16), 2400); assert.equal(bytes.readUInt32BE(20), 1000);
    const plot = chart.getByRole('group', { name: /^趋势图。/ }); await plot.focus(); await page.keyboard.press('Home'); assert.match(await chart.locator('.rex-day-tooltip').innerText(), new RegExp(start)); await page.keyboard.press('End'); assert.match(await chart.locator('.rex-day-tooltip').innerText(), new RegExp(end));
    await chart.getByRole('button', { name: '表格', exact: true }).click(); assert.equal(await chart.locator('.rex-daily-screen tbody tr').count(), 7); await chart.getByRole('button', { name: '图表', exact: true }).click();
    await chart.locator('.rex-annotations > summary').click(); await chart.getByLabel('批注日期').fill(start); await chart.getByLabel('背景类型').selectOption('version'); await chart.getByRole('textbox', { name: /^背景记录/ }).fill('已知版本发布，仅为背景，不推断因果。'); await chart.getByRole('button', { name: '保存批注', exact: true }).click(); await chart.getByText('已知版本发布，仅为背景，不推断因果。', { exact: true }).waitFor();
    await chart.getByRole('button', { name: '表格', exact: true }).click();
    assert.equal(await chart.locator('.rex-plot-wrapper').getAttribute('inert'), '');
    assert.equal(await chart.locator('.rex-plot-wrapper').getAttribute('aria-hidden'), 'true');
    assert.equal(await chart.locator('.rex-plot-wrapper g[role=button]').first().evaluate(element => { element.focus(); return document.activeElement === element; }), false, '表格视图不能聚焦隐藏批注');
    await chart.getByRole('button', { name: '图表', exact: true }).click();
    const annotationCalls = calls.length; await page.getByRole('tab', { name: '完整报告', exact: true }).click(); await page.getByRole('region', { name: '当前报告趋势与导出', exact: true }).locator('.rex-annotations > summary').click(); await page.getByText('已知版本发布，仅为背景，不推断因果。', { exact: true }).waitFor(); assert.equal(calls.length, annotationCalls, '批注不参与统计也不触发模型/探索请求');
    const table = page.getByRole('region', { name: '渠道明细表', exact: true }); await table.getByLabel('搜索渠道明细', { exact: true }).fill(channel); const tableDownload = page.waitForEvent('download'); await table.getByRole('button', { name: '导出当前表 CSV', exact: true }).click(); const tableFile = await tableDownload; const tablePath = path.join(directory, `${cloud ? 'cloud' : 'local'}-channels-table.csv`); await tableFile.saveAs(tablePath); const tableRows = parse(await readFile(tablePath), { bom: true, columns: true }); assert.ok(tableRows.every(row => row['表内筛选说明'].includes(channel)));
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390); assert.equal(await chart.locator('.rex-trend-svg').evaluate(svg => svg.getBoundingClientRect().width >= 960), true); await plot.focus(); await page.keyboard.press('End'); assert.ok(await plot.evaluate(element => element.scrollLeft > 0));
    await page.screenshot({ path: path.join(directory, `${cloud ? 'cloud' : 'local'}-explore-390.png`) }); await page.locator('.rex-scope-details, .rex-annotations, .metric-glossary').evaluateAll(items => items.forEach(item => item.removeAttribute('open'))); await page.emulateMedia({ media: 'print' }); assert.equal(await page.locator('.skip-link').isVisible(), false, '跳转链接仅用于屏幕导航'); assert.equal(await chart.locator('.rex-print-only tbody tr').count(), 7); for (const selector of ['.rex-scope-details > p', '.rex-annotations .rex-annotation-list', '.metric-glossary dl']) assert.equal(await page.locator(selector).first().evaluate(element => element.checkVisibility({ contentVisibilityAuto: true })), true, `${selector} 打印时应显示`); await page.pdf({ path: path.join(directory, `${cloud ? 'cloud' : 'local'}-current-view.pdf`), format: 'A4', printBackground: true }); await page.emulateMedia({ media: 'screen' }); await page.setViewportSize({ width: 1450, height: 1000 });
    await controls.getByRole('button', { name: '清除，查看原件', exact: true }).click(); await page.getByRole('tab', { name: '分析概览', exact: true }).click();
    const brushResult = page.waitForResponse(response => { if (!response.url().endsWith('/explore') || response.request().method() !== 'POST') return false; const body = response.request().postDataJSON(); return body.start === start && body.end === end; });
    const brushStart = chart.getByRole('slider', { name: '范围起点（原报告概览）', exact: true }), brushEnd = chart.getByRole('slider', { name: '范围终点（原报告概览）', exact: true });
    await brushStart.focus(); await page.keyboard.press('Home'); for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight'); await brushEnd.focus(); await page.keyboard.press('End'); for (let i = 0; i < dates.length - 1 - 13; i++) await page.keyboard.press('ArrowLeft'); assert.equal((await brushResult).status(), 200);
    await page.waitForFunction(period => document.querySelector('.rex-applied')?.textContent.includes(period), `${start} 至 ${end}`);
    let release; let captured;
    const gate = new Promise(resolve => { captured = resolve; }); let intercepted = false;
    await page.route('**/api/tasks/*/explore', async route => { if (intercepted) return route.continue(); intercepted = true; const response = await route.fetch(); captured(); await new Promise(resolve => { release = resolve; }); await route.fulfill({ response }).catch(() => {}); });
    await controls.getByLabel('开始日期', { exact: true }).fill(dates[8]); await controls.getByRole('button', { name: '应用筛选', exact: true }).click(); await gate;
    const newer = { start: dates[14], end: dates[20] }; const fresh = await apply(newer, false); release(); await page.unroute('**/api/tasks/*/explore'); await sleep(250); assert.match(await controls.locator('.rex-applied').innerText(), new RegExp(newer.start)); assert.equal(fresh.scope.start, newer.start);
    const outside = await apply({ start: shift(dates[0], -4), end: shift(dates[0], -3) }); assert.equal(outside.scope.sample.selectedRows, 0); assert.equal(outside.comparison.comparable, false); await controls.locator('.rex-scope-details > summary').click(); await controls.getByText(/当前条件没有期内样本/).waitFor(); assert.equal(await page.getByRole('region', { name: '日活跃玩家', exact: true }).locator('.metric-value').innerText(), '—');
    await controls.getByRole('button', { name: '清除，查看原件', exact: true }).click(); assert.match(await controls.locator('.rex-applied').innerText(), /原始报告/); assert.deepEqual((await request(`/tasks/${second.id}`)).task.report, second.report); assert.deepEqual(await request('/wallet'), baseline); assert.deepEqual(taskCreates, []); assert.deepEqual(errors, []);
    results.push({ runtime: cloud ? 'cloud' : 'local', exactRangeAndChannel: true, csvPngPdf: true, brush: true, staleResponseIgnored: true, emptyCoverageExplained: true, extraCredits: 0, errors }); await context.close();
  }
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ passed: true, results }, null, 2)); console.log(JSON.stringify({ passed: true, directory, results }));
} catch (error) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {}); await writeFile(path.join(directory, 'failure.txt'), `${error.message}\n${await page.locator('body').innerText().catch(() => '')}`); } throw error; }
finally { await browser.close(); for (const { app, server } of servers) { app.locals.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
