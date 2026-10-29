import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const filename = new URL('./data-inspection.ts', import.meta.url);
const source = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const data = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('missing business tables state affected metrics without blocking independent branches', () => {
  assert.equal(typeof data.missingTableImpacts, 'function');
  assert.match(data.missingTableImpacts(['users', 'activity']).join('；'), /收入、ARPPU、付费人数不可计算/);
  assert.equal(data.missingTableImpacts(['users', 'activity', 'payments']).length, 0);
  assert.match(data.missingTableImpacts(['payments']).join('；'), /留存/);
});
test('preview profiling is sample-only, handles empty rows and mixed values', () => {
  assert.equal(typeof data.profileColumn, 'function');
  assert.deepEqual(data.profileColumn([{ amount: 1 }, { amount: null }], 'amount'), { type: '数值', emptyRate: 50, sampleSize: 2 });
  assert.equal(data.profileColumn([], 'amount').emptyRate, null);
  assert.equal(data.profileColumn([{ x: '2026-10-01' }, { x: 'abc' }], 'x').type, '混合');
  assert.equal(data.searchPreview([{ a: 'Alpha', b: 'Beta' }, { a: 'Gamma', b: 'alpha' }], 'a', 'alpha').length, 1);
});
test('pasted TSV becomes valid CSV with quotes, tabs and line breaks preserved', () => {
  assert.equal(typeof data.pasteToCsv, 'function');
  assert.equal(data.pasteToCsv('玩家ID\t注册日期\r\nu1\t2026-10-01\r\n'), '玩家ID,注册日期\r\nu1,2026-10-01');
  assert.equal(data.pasteToCsv('a\tb\n"one\ttwo"\t"line1\nline2"'), 'a,b\r\n"one\ttwo","line1\nline2"');
  assert.equal(data.pasteToCsv('a\tb\n"one""two"\tx'), 'a,b\r\n"one""two",x');
  assert.throws(() => data.pasteToCsv('a\tb\nx'), /列数/);
  assert.throws(() => data.pasteToCsv('a\tb\n"unterminated\tx'), /引号/);
  assert.throws(() => data.pasteToCsv('a\tb'), /数据行/);
});
test('legacy datasets never claim a full quality score or source mapping', () => {
  assert.equal(typeof data.datasetSummary, 'function');
  const old = data.datasetSummary({ tables: [{ type: 'users' }], rowCount: 12, dateRange: { start: '2026-10-01', end: '2026-10-02' } });
  assert.equal(old.score, null); assert.equal(old.recorded, false); assert.ok(old.missing.includes('payments'));
  const inspection = { quality: { score: 85 }, rawRows: 12, validRows: 10, missingTables: ['activity'], analyzable: true };
  const current = data.datasetSummary({ tables: [], inspection }); assert.equal(current.score, 85); assert.equal(current.validRows, 10);
});
test('quality impacts use Chinese metric names', () => {
  assert.equal(typeof data.metricLabel, 'function');
  assert.equal(data.metricLabel('revenue'), '成功支付收入');
  assert.equal(data.metricLabel('payers'), '付费人数');
});
