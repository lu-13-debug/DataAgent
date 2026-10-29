import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import postcss from 'postcss';
const explorer = await import('./report-explorer.ts').catch(() => ({}));

test('calendar validation and brush indices preserve exact complete dates', () => {
  assert.equal(typeof explorer.rangeFromBrush, 'function');
  assert.equal(explorer.isCalendarDate('2026-02-30'), false);
  assert.equal(explorer.isCalendarDate('2024-02-29'), true);
  const days = [{ date: '2026-10-03' }, { date: '2026-10-01' }, { date: '2026-10-02' }];
  assert.deepEqual(explorer.reportDates({ daily: days }), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(explorer.rangeFromBrush(explorer.reportDates({ daily: days }), 2, 0), { start: '2026-10-01', end: '2026-10-03' });
  assert.deepEqual(explorer.brushIndices(['2026-10-01', '2026-10-03', '2026-10-05'], { start: '2026-10-02', end: '2026-10-04' }), { startIndex: 1, endIndex: 1 });
  assert.equal(explorer.rangeFromBrush([], 0, 1), undefined);
  assert.match(explorer.validateExploreInput({ start: '2026-10-03', end: '2026-10-01' }, '2026-10-12'), /开始/);
  assert.match(explorer.validateExploreInput({ start: '2026-10-01', end: '2026-10-13' }, '2026-10-12'), /完整自然日/);
  assert.match(explorer.validateExploreInput({ start: '2000-01-01', end: '2026-10-01' }, '2026-10-12'), /3660/);
  assert.equal(explorer.frozenCutoff('2026-10-13T00:00:00Z'), '2026-10-12');
  assert.equal(explorer.frozenCutoff('2026-10-12T15:59:59Z'), '2026-10-11');
});

test('narrow chart keeps readable SVG coordinates inside an independent scroll surface and reveals keyboard dates', () => {
  assert.equal(typeof explorer.trendScrollLeft, 'function');
  assert.equal(explorer.trendScrollLeft(300, 960, 9, 10, 0), 660);
  assert.equal(explorer.trendScrollLeft(300, 960, 0, 10, 660), 0);
  assert.equal(explorer.trendScrollLeft(960, 960, 9, 10, 0), 0);
  assert.equal(explorer.trendScrollLeft(300, 960, 4, 10, 320), 320);
  const root = postcss.parse(fs.readFileSync('src/report-explorer.css', 'utf8'));
  let minWidth, overflow;
  root.walkRules('.rex-trend-svg', rule => { if (rule.parent.type !== 'atrule') rule.walkDecls('min-width', decl => { minWidth = decl.value; }); });
  root.walkRules('.rex-plot-wrapper', rule => { if (rule.parent.type !== 'atrule') rule.walkDecls('overflow-x', decl => { overflow = decl.value; }); });
  assert.equal(minWidth, '960px'); assert.equal(overflow, 'auto');
  root.walkDecls(decl => {
    for (let parent = decl.parent; parent; parent = parent.parent) if (parent.type === 'atrule' && parent.params?.includes('print')) return;
    if (decl.prop === 'font-size') assert.match(decl.value, /^var\(--text-[\w]+\)$/);
    if (decl.prop === 'color') assert.match(decl.value, /^var\(--(?:ink|muted|faint|accent|warning)\)$/);
  });
});

test('all inline SVG information text has at least 4.5 contrast on chart and annotation surfaces', () => {
  const source = fs.readFileSync('src/components/ReportExplorer.tsx', 'utf8');
  const luminance = hex => { const c = [0, 2, 4].map(index => parseInt(hex.slice(index + 1, index + 3), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const fills = [...source.matchAll(/<text\b[^>]*fill="(#[0-9a-f]{6})"/g)].map(match => match[1]);
  assert.ok(fills.length >= 5);
  for (const fill of fills) for (const background of ['#ffffff', '#fff7df']) { const a = luminance(fill), b = luminance(background); assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${fill} on ${background}`); }
});

test('scope comparison ignores channel order and independently guards null, zero and incomparable values', () => {
  assert.equal(typeof explorer.metricComparison, 'function');
  const base = { start: '2026-10-01', end: '2026-10-03', channels: ['b', 'a'], comparePrevious: true };
  assert.equal(explorer.sameExploreInput(base, { ...base, channels: ['a', 'b', 'a'] }), true);
  for (const metric of [
    { id: 'revenue', comparable: false, current: 10, previous: 5, absoluteChange: 5, percentChange: 100, reason: '覆盖不足' },
    { id: 'revenue', comparable: true, current: null, previous: 5, absoluteChange: 0, percentChange: 0 },
    { id: 'revenue', comparable: true, current: 10, previous: 0, absoluteChange: 10, percentChange: Infinity },
  ]) assert.equal(explorer.metricComparison({ comparison: { requested: true, metrics: [metric] } }, 'revenue').comparable, false);
  const metric = { id: 'revenue', comparable: true, current: 6, previous: 4, absoluteChange: 2, percentChange: 50, reason: null };
  assert.deepEqual(explorer.metricComparison({ comparison: { requested: true, metrics: [metric] } }, 'revenue'), metric);
});

test('annotation storage partitions service runtime user and task and rejects damaged or unbounded entries', () => {
  assert.equal(typeof explorer.annotationStorageKey, 'function');
  const key = explorer.annotationStorageKey('cloud', 'alice', 'https://a.example', 'task-a');
  for (const args of [['cloud', 'bob', 'https://a.example', 'task-a'], ['local', 'alice', 'https://a.example', 'task-a'], ['cloud', 'alice', 'https://b.example', 'task-a'], ['cloud', 'alice', 'https://a.example', 'task-b']]) assert.notEqual(explorer.annotationStorageKey(...args), key);
  const entry = { id: 'a', date: '2026-10-01', type: 'event', text: '版本发布，仅记录背景。' };
  const storage = { value: '', getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
  assert.equal(explorer.saveAnnotations(storage, key, [entry]), true);
  assert.deepEqual(explorer.readAnnotations(storage, key), [entry]);
  storage.value = '{'; assert.deepEqual(explorer.readAnnotations(storage, key), []);
  storage.value = JSON.stringify([entry, { ...entry, date: '2026-02-30' }, { ...entry, type: 'script' }, { ...entry, text: 'x'.repeat(301) }]);
  assert.deepEqual(explorer.readAnnotations(storage, key), [entry]);
  storage.value = JSON.stringify(Array.from({ length: 150 }, (_, n) => ({ ...entry, id: `a-${n}` })));
  assert.equal(explorer.readAnnotations(storage, key).length, 100);
  const disabled = { getItem() { throw Error('disabled'); }, setItem() { throw Error('disabled'); } };
  assert.deepEqual(explorer.readAnnotations(disabled, `${key}-fresh-disabled`), []);
  assert.equal(explorer.saveAnnotations(disabled, `${key}-fresh-disabled`, [entry]), false);
});

test('annotation window-session fallback survives remount reads with blocked status and stays isolated and bounded', () => {
  assert.equal(typeof explorer.readAnnotationState, 'function');
  const disabled = { getItem() { throw Error('disabled'); }, setItem() { throw Error('disabled'); } };
  const key = explorer.annotationStorageKey('cloud', 'session-alice', 'https://session.example', 'task-a');
  const entry = { id: 'session-a', date: '2026-10-01', type: 'event', text: '禁存时保留的当前窗口批注' };
  assert.equal(explorer.saveAnnotations(disabled, key, [entry]), false);
  assert.deepEqual(explorer.readAnnotationState(disabled, key), { list: [entry], blocked: true });
  assert.deepEqual(explorer.readAnnotationState(undefined, key), { list: [entry], blocked: true }, 'localStorage getter被禁也可恢复');
  for (const args of [['cloud', 'session-bob', 'https://session.example', 'task-a'], ['local', 'session-alice', 'https://session.example', 'task-a'], ['cloud', 'session-alice', 'https://other.example', 'task-a'], ['cloud', 'session-alice', 'https://session.example', 'task-b']]) assert.deepEqual(explorer.readAnnotationState(disabled, explorer.annotationStorageKey(...args)).list, []);
  explorer.saveAnnotations(disabled, key, []); assert.deepEqual(explorer.readAnnotationState(disabled, key).list, [], '本会话删除不会复活');
  const entries = Array.from({ length: 150 }, (_, i) => ({ ...entry, id: `entry-${i}` }));
  for (let i = 0; i < 51; i++) explorer.saveAnnotations(disabled, `bounded-annotation-${i}`, entries);
  assert.deepEqual(explorer.readAnnotationState(disabled, 'bounded-annotation-0').list, [], '最多保留50个scope');
  assert.equal(explorer.readAnnotationState(disabled, 'bounded-annotation-50').list.length, 100);
});

test('healthy annotation storage overrides memory and external deletion cannot resurrect on later read failure', () => {
  assert.equal(typeof explorer.readAnnotationState, 'function');
  const key = 'normal-annotation-priority', entry = { id: 'normal', date: '2026-10-01', type: 'event', text: '旧批注' };
  let value = null, failRead = false;
  const storage = { getItem() { if (failRead) throw Error('disabled'); return value; }, setItem(key, next) { value = next; } };
  explorer.saveAnnotations(storage, key, [entry]);
  const external = { ...entry, id: 'external', text: '来自当前正常存储的新批注' }; value = JSON.stringify([external]);
  assert.deepEqual(explorer.readAnnotationState(storage, key), { list: [external], blocked: false });
  value = null; assert.deepEqual(explorer.readAnnotationState(storage, key), { list: [], blocked: false });
  failRead = true; assert.deepEqual(explorer.readAnnotationState(storage, key), { list: [], blocked: true });
  failRead = false; value = JSON.stringify([entry]); explorer.readAnnotationState(storage, key); value = '[]';
  assert.deepEqual(explorer.readAnnotationState(storage, key).list, []); failRead = true; assert.deepEqual(explorer.readAnnotationState(storage, key).list, []);
});

test('write-only storage failure preserves pending session edits until storage changes or a deletion event arrives', () => {
  const key = 'quota-annotation-session', entry = { id: 'quota-a', date: '2026-10-01', type: 'campaign', text: '未写入磁盘的本窗口活动记录' };
  let value = null;
  const storage = { getItem() { return value; }, setItem() { throw Error('QuotaExceededError'); } };
  explorer.readAnnotationState(storage, key);
  explorer.saveAnnotations(storage, key, [entry]);
  assert.deepEqual(explorer.readAnnotationState(storage, key), { list: [entry], blocked: true }, '原存储没变化时重挂仍保留未写入批注');
  const external = { ...entry, id: 'quota-external', text: '其他窗口已更改的存储' }; value = JSON.stringify([external]);
  assert.deepEqual(explorer.readAnnotationState(storage, key), { list: [external], blocked: false });
  explorer.saveAnnotations(storage, key, [entry]); value = null;
  assert.deepEqual(explorer.readAnnotationState(storage, key), { list: [], blocked: false });
  explorer.saveAnnotations(storage, key, [entry]);
  assert.deepEqual(explorer.readAnnotationState(storage, key, true), { list: [], blocked: false }, '显式存储删除/clear事件不复活未写入批注');
});

test('trend series keeps real previous dates and separates paths across missing coverage', () => {
  assert.equal(typeof explorer.trendRows, 'function');
  const report = { daily: [{ date: '2026-10-04', dau: 2 }, { date: '2026-10-05', dau: null }, { date: '2026-10-06', dau: 4 }] };
  const previous = { daily: [{ date: '2026-10-01', dau: 1 }, { date: '2026-10-02', dau: 0 }, { date: '2026-10-03', dau: null }] };
  const rows = explorer.trendRows(report, previous);
  assert.equal(rows[1].previousDate, '2026-10-02'); assert.equal(rows[1].previousDau, 0);
  const paths = explorer.linePaths(rows, 'dau', { left: 10, top: 10, width: 100, height: 100, max: 4 });
  assert.equal(paths.length, 2); assert.ok(paths.every(path => !path.includes('NaN')));
});

const flush = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
function hookHarness() {
  const pending = [], hooks = [], effects = [], timers = new Map(); let cursor = 0, timerId = 0;
  let task = { id: 'task-a', status: 'completed', report: { generatedAt: '2026-10-13T00:00:00Z', daily: [{ date: '2026-10-01' }, { date: '2026-10-02' }, { date: '2026-10-03' }] } };
  let enabled = true, user = { id: 'alice' };
  const react = {
    useRef(value) { const n = cursor++; return hooks[n] ??= { current: value }; },
    useState(value) { const n = cursor++; if (!(n in hooks)) hooks[n] = typeof value === 'function' ? value() : value; return [hooks[n], next => { hooks[n] = typeof next === 'function' ? next(hooks[n]) : next; }]; },
    useCallback(fn) { cursor++; return fn; }, useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, deps) { const n = cursor++; const old = hooks[n]; if (!old || !deps || deps.some((value, i) => value !== old.deps[i])) effects.push(() => { old?.cleanup?.(); hooks[n] = { deps, cleanup: fn() }; }); },
  };
  const context = { exports: {}, require: name => name === 'react' ? react : name === './api' ? { api: { explore(id, input, signal) { return new Promise((resolve, reject) => pending.push({ id, input, signal, resolve, reject })); } } } : name === './auth-context' ? { useAuth: () => ({ runtime: { mode: 'cloud' }, user }) } : explorer,
    window: { location: { origin: 'https://a.example' } }, AbortController, Date,
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) };
  const source = fs.existsSync('src/use-report-explorer.ts') ? ts.transpileModule(fs.readFileSync('src/use-report-explorer.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText : '';
  vm.runInNewContext(source, context);
  assert.equal(typeof context.exports.useReportExplorer, 'function');
  return {
    pending,
    render(nextTask = task, nextEnabled = enabled, nextUser = user) { task = nextTask; enabled = nextEnabled; user = nextUser; cursor = 0; const value = context.exports.useReportExplorer(task, enabled); while (effects.length) effects.shift()(); return value; },
    timers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    task: () => task,
    cleanup() { hooks.forEach(hook => hook?.cleanup?.()); },
  };
}
const resultFor = (request, marker) => ({ report: { ...marker, daily: [] }, scope: { ...request.input, channels: request.input.channels || [] }, comparison: { requested: !!request.input.comparePrevious, metrics: [] } });

test('real hook aborts superseded work and ignores late responses after clear or task and account changes', async () => {
  const harness = hookHarness(); let hook = harness.render();
  hook.setDraft({ start: '2026-10-01', end: '2026-10-01', channels: [] }); hook = harness.render(); void hook.apply();
  const first = harness.pending[0];
  hook.setDraft({ start: '2026-10-02', end: '2026-10-02', channels: [] }); hook = harness.render(); void hook.apply();
  const second = harness.pending[1]; assert.equal(first.signal.aborted, true);
  second.resolve(resultFor(second, { marker: 'new' })); await flush(); hook = harness.render(); assert.equal(hook.displayReport.marker, 'new');
  first.resolve(resultFor(first, { marker: 'late' })); await flush(); hook = harness.render(); assert.equal(hook.displayReport.marker, 'new');
  void hook.apply(); const third = harness.pending[2]; hook.clear(); third.resolve(resultFor(third, { marker: 'cleared' })); await flush(); hook = harness.render(); assert.equal(hook.result, undefined); assert.equal(hook.displayReport, harness.task().report);
  void hook.apply(); const fourth = harness.pending[3]; const next = { ...harness.task(), id: 'task-b', report: { ...harness.task().report, marker: 'b' } };
  hook = harness.render(next); assert.equal(fourth.signal.aborted, true); assert.equal(hook.displayReport.marker, 'b');
  fourth.resolve(resultFor(fourth, { marker: 'wrong-task' })); await flush(); hook = harness.render(); assert.equal(hook.displayReport.marker, 'b');
  void hook.apply(); const fifth = harness.pending[4]; harness.render(next, true, { id: 'bob' }); assert.equal(fifth.signal.aborted, true);
  fifth.resolve(resultFor(fifth, { marker: 'wrong-user' })); await flush(); hook = harness.render(); assert.equal(hook.result, undefined);
  harness.cleanup();
});

test('real hook debounces brush from original dates and retains applied report during drafts, pending and errors', async () => {
  const harness = hookHarness(); let hook = harness.render();
  hook.setRangeFromBrush(0, 1); hook.setRangeFromBrush(1, 2); harness.timers(); assert.equal(harness.pending.length, 1);
  assert.equal(harness.pending[0].input.start, '2026-10-02'); assert.equal(harness.pending[0].input.end, '2026-10-03');
  harness.pending[0].resolve(resultFor(harness.pending[0], { marker: 'applied' })); await flush(); hook = harness.render();
  hook.setDraft({ ...hook.draft, start: '2026-10-01' }); hook = harness.render(); assert.equal(hook.dirty, true); assert.equal(hook.displayReport.marker, 'applied');
  void hook.apply(); hook = harness.render(); assert.equal(hook.loading, true); assert.equal(hook.displayReport.marker, 'applied');
  harness.pending[1].reject(Error('源数据已删除')); await flush(); hook = harness.render(); assert.equal(hook.displayReport.marker, 'applied'); assert.match(hook.error, /源数据/);
  hook = harness.render(harness.task(), false); void hook.apply(); hook.setRangeFromBrush(0, 2); harness.timers(); assert.equal(harness.pending.length, 2); assert.equal(hook.displayReport, harness.task().report);
  harness.cleanup();
});

async function componentModule(storage = { getItem() { return null; } }) {
  const requireReal = createRequire(import.meta.url), exporter = await import('./report-export.ts');
  const context = { exports: {}, require: name => name === '../report-explorer' ? explorer : name === '../report-export' ? exporter : name === '../auth-context' ? { useAuth: () => ({ runtime: { mode: 'local' }, user: null }) } : name === './ui' ? { number: value => value == null ? '—' : String(value), downloadText() {} } : name.endsWith('.css') ? {} : requireReal(name), window: { location: { origin: 'http://localhost' } }, localStorage: storage };
  const source = fs.existsSync('src/components/ReportExplorer.tsx') ? ts.transpileModule(fs.readFileSync('src/components/ReportExplorer.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText : '';
  vm.runInNewContext(source, context); assert.equal(typeof context.exports.ReportExplorer, 'function'); return context.exports;
}
test('real components disclose applied scope, render bounded channel choices and preserve old-service chart/table exports', async () => {
  const { ReportExplorer, ExplorerChart } = await componentModule();
  const report = { title: '当前报告', period: '2026-10-01 至 2026-10-03', generatedAt: '2026-10-13T00:00:00Z', currency: 'CNY', daily: [{ date: '2026-10-01', dau: 2, newUsers: 1, revenue: 10, payers: 1 }], metrics: [], channels: Array.from({ length: 200000 }, (_, i) => ({ name: `渠道-${i}` })), retention: [], quality: { rows: 6, issues: [] } };
  const task = { id: 'sample', title: '样本任务', report };
  const hook = { enabled: true, draft: { start: '2026-10-02', end: '2026-10-03', channels: [] }, dates: ['2026-10-01', '2026-10-02', '2026-10-03'], originalRange: { start: '2026-10-01', end: '2026-10-03' }, displayReport: report, loading: true, dirty: true, cutoff: '2026-10-12', setDraft() {}, apply() {}, clear() {}, setRangeFromBrush() {} };
  const controls = renderToStaticMarkup(createElement(ReportExplorer, { task, explorer: hook }));
  assert.match(controls, /下方仍为/); assert.match(controls, /原始报告/); assert.equal((controls.match(/class="rex-channel-choice(?: |")/g) || []).length, 24);
  const fallback = renderToStaticMarkup(createElement(ReportExplorer, { task, explorer: { ...hook, enabled: false, loading: false } }));
  assert.match(fallback, /未声明.*精确筛选/); assert.doesNotMatch(fallback, /type="date"/);
  const chart = renderToStaticMarkup(createElement(ExplorerChart, { task, explorer: { ...hook, enabled: false, loading: false } }));
  for (const text of ['图表', '表格', '指标 CSV', '渠道 CSV', '留存 CSV', '每日 CSV', 'PNG', 'aria-live="polite"', 'ArrowLeft', '批注不参与计算']) assert.ok(chart.includes(text), text);
});

test('real annotation component remount restores blocked session notes and persistence warning', async () => {
  const disabled = { getItem() { throw Error('disabled'); }, setItem() { throw Error('disabled'); } };
  const key = explorer.annotationStorageKey('local', undefined, 'http://localhost', 'remount-annotation');
  const entry = { id: 'remount-note', date: '2026-10-01', type: 'version', text: '切换完整报告后仍应保留的发布记录' };
  explorer.saveAnnotations(disabled, key, [entry]);
  const report = { currency: 'CNY', daily: [{ date: entry.date, dau: 1, newUsers: 1, revenue: 0, payers: 0 }], channels: [], metrics: [], retention: [] };
  const task = { id: 'remount-annotation', title: '批注重挂测试', report };
  const hook = { displayReport: report, originalRange: { start: entry.date, end: entry.date }, cutoff: '2026-10-12' };
  for (let mount = 0; mount < 2; mount++) {
    const { ExplorerChart } = await componentModule(disabled);
    const markup = renderToStaticMarkup(createElement(ExplorerChart, { task, explorer: hook }));
    assert.ok(markup.includes(entry.text), '重建组件后应有会话内批注'); assert.match(markup, /浏览器未允许持久保存/);
  }
});
