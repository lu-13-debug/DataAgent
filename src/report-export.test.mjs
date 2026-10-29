import test from 'node:test';
import assert from 'node:assert/strict';
const exporter = await import('./report-export.ts').catch(() => ({}));
const report = {
  period: '2026-10-02 至 2026-10-04', currency: 'CNY',
  metrics: [{ id: 'revenue', label: '=SUM(A1)', value: 6, unit: 'CNY', note: '含"引号",换行\n口径' }],
  channels: [{ name: ' \t=HYPERLINK("evil")', users: null, revenue: 6, d1: null }],
  retention: [{ date: '2026-10-02', users: 1, d1: 100, d7: null }],
  daily: [{ date: '2026-10-02', dau: 1, newUsers: 1, revenue: 2, payers: 1 }],
};

test('CSV string formula prefixes are neutralized without changing numeric negatives, with RFC quote/newline escaping', () => {
  assert.equal(typeof exporter.csvCell, 'function');
  for (const value of ['=1+1', '+cmd', '-cmd', '@SUM(A1)', ' \t=cmd', '\n=cmd', '\r@cmd', '\tname']) assert.ok(exporter.csvCell(value).includes("'"), value);
  assert.equal(exporter.csvCell(-2), '-2');
  assert.equal(exporter.csvCell(null), '');
  assert.equal(exporter.csvCell('a,"b"\nc'), '"a,""b""\nc"');
});

test('CSV exports the current report metrics channels retention and date scope without guessing null as zero', () => {
  assert.equal(typeof exporter.reportCsv, 'function');
  const scope = { start: '2026-10-02', end: '2026-10-04', channels: ['自然'] };
  const metrics = exporter.reportCsv(report, 'metrics', scope);
  assert.match(metrics, /2026-10-02/); assert.match(metrics, /自然/); assert.match(metrics, /'=SUM/);
  assert.match(metrics, /6,CNY/); assert.match(metrics, /"含""引号"",换行\n口径"/);
  const channels = exporter.reportCsv(report, 'channels', scope);
  assert.match(channels, /,CNY/); assert.match(channels, /,6,,/);
  assert.match(exporter.reportCsv(report, 'retention', scope), /2026-10-02,1,100,,/);
  assert.match(exporter.reportCsv(report, 'daily', scope), /2026-10-02,1,1,2,1/);
  assert.equal(metrics.startsWith('\uFEFF'), false, 'BOM由现有downloadText统一添加');
  assert.match(exporter.reportCsv({ ...report, channels: [] }, 'channels', scope), /2026-10-02/, '空样本导出也保留当前范围');
});

test('CSV table-only filter note remains distinct from exact scope and neutralizes injected formulas and newlines', () => {
  const scope = { start: '2026-10-02', end: '2026-10-04', channels: ['自然'] };
  const note = '=HYPERLINK("x")\n渠道名称包含 foo,"bar"';
  const value = exporter.reportCsv(report, 'channels', scope, note);
  assert.match(value.split('\r\n')[0], /表内筛选说明$/);
  assert.ok(value.endsWith(exporter.csvCell(note)));
  assert.match(value, /2026-10-02,2026-10-04,自然,/);
  assert.ok(value.includes('"\'=HYPERLINK(""x"")\n渠道名称包含 foo,""bar"""'));
  assert.ok(exporter.reportCsv(report, 'channels', scope).endsWith(','), '三参数调用仍保留原范围含义，新增说明缺省为空');
});

test('PNG export rasterizes only the current local SVG on white and releases temporary object URLs', async () => {
  assert.equal(typeof exporter.exportTrendPng, 'function');
  const previous = Object.fromEntries(['document', 'Image', 'XMLSerializer'].map(key => [key, globalThis[key]]));
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL, revoked = [], attrs = {}, calls = [];
  let index = 0, clicked = false;
  URL.createObjectURL = () => `blob:local-${++index}`; URL.revokeObjectURL = value => revoked.push(value);
  globalThis.XMLSerializer = class { serializeToString() { return '<svg><text>当前范围</text></svg>'; } };
  globalThis.Image = class { set src(value) { assert.match(value, /^blob:local-/); queueMicrotask(() => this.onload()); } };
  globalThis.document = { createElement(kind) { return kind === 'canvas' ? { getContext: () => ({ set fillStyle(value) { calls.push(value); }, fillRect: (...args) => calls.push(args), drawImage() { calls.push('draw'); } }), toBlob: done => done(new Blob(['png'])) } : { click() { clicked = true; } }; } };
  try {
    await exporter.exportTrendPng({ cloneNode: () => ({ setAttribute(key, value) { attrs[key] = value; }, style: {} }) }, '当前期间.png');
    assert.equal(attrs['font-family'].includes('Microsoft YaHei'), true); assert.equal(attrs.width, '1200'); assert.equal(calls[0], '#ffffff'); assert.equal(clicked, true); assert.ok(revoked.includes('blob:local-1'));
    globalThis.Image = class { set src(value) { queueMicrotask(() => this.onerror()); } };
    await assert.rejects(exporter.exportTrendPng({ cloneNode: () => ({ setAttribute() {}, style: {} }) }, '失败.png'), /失败.*CSV/);
    assert.ok(revoked.includes('blob:local-3'));
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
  }
});

test('PNG image decoding has a bounded failure path rather than leaving export busy forever', async () => {
  const previous = Object.fromEntries(['Image', 'XMLSerializer', 'setTimeout', 'clearTimeout'].map(key => [key, globalThis[key]]));
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL; let timeout;
  globalThis.XMLSerializer = class { serializeToString() { return '<svg/>'; } };
  globalThis.Image = class { set src(value) {} };
  globalThis.setTimeout = (fn, ms) => { assert.ok(ms <= 10000); timeout = fn; return 7; }; globalThis.clearTimeout = () => {};
  URL.createObjectURL = () => 'blob:local'; URL.revokeObjectURL = () => {};
  try {
    const pending = exporter.exportTrendPng({ cloneNode: () => ({ setAttribute() {}, style: {} }) }, 'timeout.png');
    const result = assert.rejects(pending, /超时.*CSV/);
    assert.equal(typeof timeout, 'function'); timeout(); await result;
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
  }
});

test('export filename is bounded and safe for Windows reserved names and characters', () => {
  assert.equal(typeof exporter.exportFilename, 'function');
  assert.equal(exporter.exportFilename('CON', '2026-10-02', '2026-10-04', 'metrics', 'csv'), '_CON_2026-10-02_2026-10-04_metrics.csv');
  const name = exporter.exportFilename('运维: <报告> /A\\B?*|. ', '2026-10-02', '2026-10-04', 'trend', 'png');
  assert.ok(!/[<>:"/\\|?*]/.test(name)); assert.match(name, /2026-10-02_2026-10-04_trend\.png$/);
  assert.ok(exporter.exportFilename('长'.repeat(300), '2026-10-02', '2026-10-04', 'daily', 'csv').length < 180);
});
