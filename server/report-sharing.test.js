import test from 'node:test';
import assert from 'node:assert/strict';
import { shareSnapshot } from './report-sharing.js';

test('snapshot uses fixed fields and text, never user strings, AI output or hidden payments', () => {
  const secret = 'account-secret-player-id';
  const input = { source:'ai', title:secret, currency:'KEY', summary:secret, methodology:[secret], findings:[secret], recommendations:[secret], records:[secret],
    metrics:[{id:'dau', label:secret, value:12, unit:secret, note:secret}, {id:'revenue', value:234}, {id:secret,value:123}],
    daily:[{date:'2026-10-01',dau:12,newUsers:2,revenue:234,payers:5, secret}], retention:[{date:'2026-10-01',users:2,d1:50,d7:null,secret}], channels:[{name:secret,revenue:234}] };
  const hidden = shareSnapshot(input, true), plain = shareSnapshot(input, false);
  for (const result of [hidden, plain]) assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(plain.currency, null); assert.equal(plain.metrics.find(x => x.id === 'revenue').value, 234);
  assert.equal(Object.hasOwn(hidden, 'currency'), false); assert.equal(Object.hasOwn(hidden.daily[0], 'revenue'), false); assert.equal(Object.hasOwn(hidden.daily[0], 'payers'), false);
  assert.deepEqual(hidden.metrics.map(x => x.id), ['dau']);
});

test('reports expose only verified date ranges, explicit truncation and known sample status', () => {
  const report = { period: '2025-01-01 至 2026-12-31', source:'local', metrics: [
    { id:'dau', value:20, note:'2026-12-30 最后完整活跃覆盖自然日；按 user_id 去重' },
    { id:'new_users', value:3, note:'2025-01-01 至 2026-12-29；以注册表为准' },
    { id:'d1_retention', value:null, note:'2025-01-01 至 2026-12-31 secret' },
    { id:'revenue', value:45, note:'2025-02-01 至 2026-12-28；成功订单按 order_id 去重；金额以整数分计算' }
  ], daily:Array.from({length:367}, () => ({date:'2025-01-01'})), retention:Array.from({length:367}, () => ({date:'2025-01-01'})) };
  const result = shareSnapshot(report, true, 'demo');
  assert.deepEqual(result.period, {start:'2025-01-01',end:'2026-12-31'});
  assert.deepEqual(result.metrics[0].coverage, {start:'2026-12-30',end:'2026-12-30'});
  assert.deepEqual(result.metrics[1].coverage, {start:'2025-01-01',end:'2026-12-29'});
  assert.equal(result.metrics[2].coverage, null);
  assert.equal(result.dailyTruncated, true); assert.equal(result.retentionTruncated, true);
  assert.equal(result.sample, true); assert.equal(result.sampleNotice, '本报告使用示例数据，不代表真实业务。');
  assert.doesNotMatch(JSON.stringify(result), /secret|"revenue"|order_id/i);
  const unknown = shareSnapshot({ ...report, period:'2025-01-01 至 2026-12-31 secret', daily:[], retention:[], metrics:[{id:'dau',value:5,note:'2026-12-30 secret'}] }, true);
  assert.equal(unknown.period, null); assert.equal(unknown.metrics[0].coverage, null); assert.equal(unknown.metrics[0].method, null); assert.equal(unknown.sample, null);
  assert.equal(unknown.dailyTruncated, false); assert.equal(unknown.retentionTruncated, false);
  const real = shareSnapshot(report, false, 'upload'); assert.equal(real.sample, false);
  assert.deepEqual(real.metrics.find(x => x.id === 'revenue').coverage, {start:'2025-02-01',end:'2026-12-28'});
});
