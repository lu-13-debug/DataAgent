import test from 'node:test';
import assert from 'node:assert/strict';
const tables = await import('./report-tables.ts').catch(() => ({}));
test('channel detail pages stay bounded for 200000 channels, preserve nulls and never mutate source data', () => {
  assert.equal(typeof tables.channelTablePage, 'function');
  const channels = Object.freeze(Array.from({ length: 200000 }, (_, index) => ({ name: `渠道-${index}`, users: index ? 1 : null, revenue: index, d1: null })));
  const first = tables.channelTablePage(channels, '', 0); assert.equal(first.rows.length, 25); assert.equal(first.rows[0].users, null); assert.equal(first.pages, 8000);
  const last = tables.channelTablePage(channels, '', 999999); assert.equal(last.page, 7999); assert.equal(last.rows.at(-1).name, '渠道-199999');
  const searched = tables.channelTablePage(channels, '渠道-19999', 10); assert.equal(searched.matched, 11); assert.equal(searched.rows.length, 11); assert.equal(searched.page, 0);
  const empty = tables.channelTablePage(channels, '没有这个渠道', 8); assert.equal(empty.rows.length, 0); assert.equal(empty.pages, 1); assert.equal(empty.page, 0);
});
