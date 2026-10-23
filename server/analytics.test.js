import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('./analytics.js').catch(() => ({}));
const fixtures = () => ({ name: '手算样本', source: 'upload', warnings: [], records: {
  users: [
    { user_id: 'a', registered_at: '2026-10-01T00:10:00+08:00', channel: '自然' },
    { user_id: 'b', registered_at: '2026-10-01T10:00:00+08:00', channel: '广告' },
    { user_id: 'c', registered_at: '2026-10-02T12:00:00+08:00', channel: '自然' },
    { user_id: 'old', registered_at: '2026-09-01T12:00:00+08:00', channel: '广告' },
  ],
  activity: [
    { user_id: 'a', event_time: '2026-10-01T15:00:00Z' },
    { user_id: 'a', event_time: '2026-10-01T15:10:00Z' },
    { user_id: 'b', event_time: '2026-10-01T16:00:00Z' },
    { user_id: 'a', event_time: '2026-10-02T02:00:00Z' },
    { user_id: 'a', event_time: '2026-10-08T02:00:00Z' },
    { user_id: 'old', event_time: '2026-10-08T03:00:00Z' },
  ],
  payments: [
    { order_id: 'x', user_id: 'a', paid_at: '2026-10-08T02:00:00Z', amount: '10.10', currency: 'CNY', status: 'success' },
    { order_id: 'x', user_id: 'a', paid_at: '2026-10-08T02:00:00Z', amount: '10.10', currency: 'CNY', status: 'success' },
    { order_id: 'y', user_id: 'c', paid_at: '2026-10-08T02:00:00Z', amount: '0.20', currency: 'CNY', status: 'paid' },
    { order_id: 'z', user_id: 'b', paid_at: '2026-10-08T02:00:00Z', amount: '100.00', currency: 'CNY', status: 'failed' },
  ],
}});

test('Shanghai daily uniqueness, mature return-on retention and exact successful-order money', () => {
  assert.equal(typeof module.analyze, 'function', '必须提供真实分析器');
  const r = module.analyze(fixtures(), { now: '2026-10-10T00:00:00Z' });
  const metric = id => r.metrics.find(m => m.id === id)?.value;
  assert.equal(metric('dau'), 2);
  assert.equal(metric('revenue'), 10.3);
  assert.equal(metric('arppu'), 5.15);
  assert.equal(metric('pay_rate'), 50);
  assert.equal(r.daily.find(d => d.date === '2026-10-01').dau, 1);
  assert.equal(r.daily.find(d => d.date === '2026-10-02').dau, 2);
  assert.equal(r.retention.find(d => d.date === '2026-10-01').d1, 100);
  assert.equal(r.retention.find(d => d.date === '2026-10-01').d7, 50);
  assert.equal(r.retention.find(d => d.date === '2026-10-02').d7, null);
  assert.equal(r.quality.issues.some(x => x.includes('重复订单')), true);
  assert.equal(r.currency, 'CNY');
});

test('missing tables produce null metrics and explicit limitations', () => {
  assert.equal(typeof module.analyze, 'function');
  const r = module.analyze({ name: '仅注册', warnings: [], records: { users: fixtures().records.users } }, { now: '2026-10-10T00:00:00Z' });
  assert.equal(r.metrics.find(m => m.id === 'dau').value, null);
  assert.equal(r.metrics.find(m => m.id === 'revenue').value, null);
  assert.equal(r.retention[0].d1, null);
  assert.match(r.quality.issues.join(' '), /缺少活跃表/);
  assert.match(r.quality.issues.join(' '), /缺少支付表/);
});

test('mixed currencies and invalid money are rejected instead of summed', () => {
  assert.equal(typeof module.analyze, 'function');
  const d = fixtures();
  d.records.payments[2].currency = 'USD';
  assert.throws(() => module.analyze(d), /混合币种/);
  d.records.payments[2].currency = 'CNY';
  d.records.payments[2].amount = '-1';
  assert.throws(() => module.analyze(d), /金额/);
});

test('current Shanghai day is excluded and goal/context survive into report', () => {
  assert.equal(typeof module.analyze, 'function');
  const d = fixtures();
  d.records.activity.push({ user_id: 'today', event_time: '2026-10-10T00:00:00Z' });
  const r = module.analyze(d, { now: '2026-10-10T10:00:00Z', goal: '优先看买量质量', messages: [{ role: 'user', content: '关注自然渠道' }] });
  assert.equal(r.daily.at(-1).date, '2026-10-09');
  assert.match(r.summary, /买量质量/);
  assert.match(r.recommendations.join(' '), /自然渠道/);
});

test('retention cannot treat days outside activity coverage as failed returns', () => {
  const d = fixtures();
  d.records.users.push({ user_id: 'late', registered_at: '2026-10-09T09:00:00+08:00', channel: '自然' });
  d.records.payments.push({ order_id: 'late-order', user_id: 'late', paid_at: '2026-10-10T09:00:00+08:00', amount: '1.00', currency: 'CNY', status: 'paid' });
  const r = module.analyze(d, { now: '2026-10-12T00:00:00Z' });
  assert.equal(r.retention.find(c => c.date === '2026-09-01').d1, null);
  assert.equal(r.retention.find(c => c.date === '2026-10-09').d1, null);
  assert.match(r.methodology.join(' '), /活跃表覆盖范围/);
});

test('independent table coverage stays null outside range and latest active-day monetization shares its date', () => {
  const d = { name: '错位覆盖', source: 'upload', warnings: [], records: {
    users: [
      { user_id: 'a', registered_at: '2026-10-01', channel: '自然' },
      { user_id: 'b', registered_at: '2026-10-02', channel: '自然' },
    ],
    activity: [
      { user_id: 'a', event_time: '2026-10-01T09:00:00+08:00' },
      { user_id: 'a', event_time: '2026-10-02T09:00:00+08:00' },
      { user_id: 'b', event_time: '2026-10-02T10:00:00+08:00' },
    ],
    payments: [
      { order_id: 'p1', user_id: 'a', paid_at: '2026-10-02', amount: '10.00', currency: 'USD', status: 'paid' },
      { order_id: 'p2', user_id: 'a', paid_at: '2026-10-20', amount: '3.00', currency: 'USD', status: 'paid' },
    ],
  } };
  const r = module.analyze(d, { now: '2026-10-23T00:00:00Z' });
  const metric = id => r.metrics.find(m => m.id === id);
  assert.equal(r.daily.at(-1).date, '2026-10-20');
  assert.equal(r.daily.at(-1).dau, null);
  assert.equal(r.daily.at(-1).newUsers, null);
  assert.equal(r.daily[0].revenue, null);
  assert.equal(r.daily[0].payers, null);
  assert.equal(r.daily.find(day => day.date === '2026-10-03').revenue, 0, '覆盖范围内的无订单日才是真实零');
  assert.equal(metric('dau').value, 2);
  assert.match(metric('dau').note, /2026-10-02/);
  assert.equal(metric('pay_rate').value, 50);
  assert.match(metric('pay_rate').note, /2026-10-02/);
  assert.equal(metric('arpdau').value, 5);
  assert.match(metric('arpdau').note, /2026-10-02/);
  for (const id of ['revenue', 'arppu', 'arpdau']) assert.notEqual(metric(id).unit, '元');
  assert.match(r.quality.issues.join(' '), /跨表覆盖范围不一致/);
  assert.match(r.summary, /2026-10-02/);
  assert.equal(r.retention[0].d7, null);

  d.records.payments = [d.records.payments[1]];
  const noOverlap = module.analyze(d, { now: '2026-10-23T00:00:00Z' });
  assert.equal(noOverlap.metrics.find(m => m.id === 'pay_rate').value, null);
  assert.equal(noOverlap.metrics.find(m => m.id === 'arpdau').value, null);
});

test('ARPDAU is same-active-day successful revenue per DAU in the original currency', () => {
  const r = module.analyze(fixtures(), { now: '2026-10-10T00:00:00Z' });
  const metric = r.metrics.find(m => m.id === 'arpdau');
  assert.ok(metric, '必须返回 ARPDAU 指标');
  assert.equal(metric.value, 5.15);
  assert.equal(metric.unit, '元');
  assert.match(metric.note, /2026-10-08/);
});
