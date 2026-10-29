import test from 'node:test';
import assert from 'node:assert/strict';
const assets = await import('./report-assets.ts').catch(() => ({}));
const report = { period: '2026-10-01 至 2026-10-07', currency: 'CNY', methodology: ['上海自然日；成功订单去重'], metrics: [{ id: 'revenue', label: '收入', value: 10, unit: '元', note: '期间成功订单' }, { id: 'd1', label: '留存', value: 30, unit: '%', note: '成熟群体' }] };
const task = { id: 'a', title: '留存复盘', datasetId: 'source-a', datasetName: '玩家数据', status: 'completed', createdAt: '2026-10-07T17:00:00Z', report, goal: '分析留存\n业务背景：更新版本', messages: [{ role: 'user', content: '自然渠道新增活动' }, { role: 'assistant', content: '不可作为用户背景复制' }] };
test('report comparison requires the same confirmed source, period, currency and definitions', () => {
  assert.equal(typeof assets.compareReports, 'function');
  const b = { ...task, id: 'b', report: { ...report, metrics: report.metrics.map(metric => ({ ...metric, value: metric.value + 2 })) } };
  const comparable = assets.compareReports(task, b);
  assert.equal(comparable.comparable, true); assert.equal(comparable.rows[0].difference, 2); assert.equal(comparable.rows[1].differenceUnit, '个百分点');
  for (const changed of [{ ...b, datasetId: 'other' }, { ...b, report: { ...b.report, period: '2026-10-08 至 2026-10-14' } }, { ...b, report: { ...b.report, currency: 'USD' } }, { ...b, report: { ...b.report, methodology: [] } }, { ...b, report: { ...b.report, metrics: [{ ...report.metrics[0], note: '不同口径' }] } }]) {
    const result = assets.compareReports(task, changed); assert.equal(result.comparable, false); assert.ok(result.reasons.length); assert.ok(result.rows.every(row => row.difference === null));
  }
  assert.equal(assets.compareReports(task, { ...b, report: { ...b.report, metrics: b.report.metrics.map(metric => ({ ...metric, value: null })) } }).rows[0].difference, null);
});
test('metadata merges independently by revision and fallback stores only scoped non-sensitive fields', () => {
  assert.equal(typeof assets.mergeReportMetadata, 'function');
  const current = { favorite: true, pinned: false, tags: ['留存'], revision: 3 };
  assert.deepEqual(assets.mergeReportMetadata(current, { ...current, favorite: false, revision: 2 }), current);
  assert.deepEqual(assets.mergeReportMetadata(current, undefined), current);
  const map = new Map(); const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  const key = assets.metadataStorageKey('cloud', 'one', 'https://a.test');
  assert.notEqual(key, assets.metadataStorageKey('cloud', 'two', 'https://a.test')); assert.notEqual(key, assets.metadataStorageKey('local', 'one', 'https://a.test'));
  assets.saveLocalMetadata(storage, key, { a: { ...current, apiKey: 'must-not-store', report: 'private-records' } });
  assert.deepEqual(assets.readLocalMetadata(storage, key), { a: current }); assert.doesNotMatch(map.get(key), /must-not-store|private-records|apiKey/);
  assert.deepEqual(assets.readLocalMetadata({ getItem() { throw Error('disabled'); } }, key), {});
});
test('report filters use Shanghai creation dates, metadata tags and stable pinned ordering', () => {
  assert.equal(typeof assets.filterReports, 'function');
  const tasks = [task, { ...task, id: 'b', title: '收入复盘', createdAt: '2026-10-09T00:00:00Z' }];
  const metadata = { a: { favorite: true, pinned: true, tags: ['留存'], revision: 1 } };
  assert.equal(assets.filterReports(tasks, {}, metadata)[0].id, 'a');
  assert.deepEqual(assets.filterReports(tasks, { start: '2026-10-08', end: '2026-10-08', tag: '留存', favoriteOnly: true }, metadata).map(item => item.id), ['a']);
  assert.deepEqual(assets.filterReports(tasks, { datasetId: 'unknown' }, metadata), []);
});
test('continuation separates the prior goal and explicit business context without copying AI prose', () => {
  assert.equal(typeof assets.continuationDraft, 'function');
  const draft = assets.continuationDraft(task);
  assert.equal(draft.goal, '分析留存'); assert.equal(draft.context, '更新版本');
  assert.equal(draft.sourceTaskId, 'a'); assert.deepEqual(draft.inheritedMessages, ['自然渠道新增活动']);
});
test('matching unknown periods or empty definitions never count as a confirmed comparison basis', () => {
  const unknown = { ...task, report: { ...report, period: '未知期间' } };
  assert.equal(assets.compareReports(unknown, { ...unknown, id: 'b' }).comparable, false);
  const missing = { ...task, report: { ...report, metrics: report.metrics.map(metric => ({ ...metric, note: '' })) } };
  assert.equal(assets.compareReports(missing, { ...missing, id: 'b' }).comparable, false);
});
test('incomparable reports keep each original unit when displaying the original values', () => {
  const other = { ...task, id: 'b', report: { ...report, currency: 'USD', metrics: report.metrics.map(metric => metric.id === 'revenue' ? { ...metric, unit: 'USD', value: 20 } : metric) } };
  const result = assets.compareReports(task, other); assert.equal(result.comparable, false);
  assert.equal(result.rows[0].leftUnit, '元'); assert.equal(result.rows[0].rightUnit, 'USD'); assert.equal(result.rows[0].difference, null);
});
test('completed report ordering and date filters use generation time with creation fallback', () => {
  const first = { ...task, id: 'a', createdAt: '2026-10-01T00:00:00Z', report: { ...report, generatedAt: '2026-10-10T17:00:00Z' } };
  const second = { ...task, id: 'b', createdAt: '2026-10-09T00:00:00Z', report: { ...report, generatedAt: '2026-10-09T20:00:00Z' } };
  assert.equal(assets.filterReports([first, second], {}, {})[0].id, 'a');
  assert.deepEqual(assets.filterReports([first, second], { start: '2026-10-11', end: '2026-10-11' }, {}).map(item => item.id), ['a']);
});
test('legacy metadata patches merge the latest persisted revision instead of a stale tab snapshot', () => {
  assert.equal(typeof assets.patchLocalReportMetadata, 'function');
  const saved = { a: { favorite: true, pinned: false, tags: [], revision: 1 } };
  const stale = { a: { favorite: false, pinned: false, tags: [], revision: 0 } };
  const next = assets.patchLocalReportMetadata(saved, stale, 'a', { tags: ['跨页标签'] });
  assert.deepEqual(next.a, { favorite: true, pinned: false, tags: ['跨页标签'], revision: 2 });
  const second = assets.patchLocalReportMetadata(next, {}, 'b', { pinned: true }); assert.deepEqual(second.a, next.a); assert.equal(second.b.pinned, true);
  const unsaved = { a: { ...next.a, favorite: false, revision: 3 } };
  assert.equal(assets.patchLocalReportMetadata(next, unsaved, 'a', { pinned: true }).a.favorite, false);
});
