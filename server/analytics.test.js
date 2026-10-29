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

const rangeFixture = () => ({ name: '探索手算样本', source: 'upload', warnings: [], records: {
  users: [
    { user_id: 'old-a', registered_at: '2026-09-30', channel: '自然' },
    { user_id: 'new-a', registered_at: '2026-10-02', channel: '自然' },
    { user_id: 'new-b', registered_at: '2026-10-04', channel: '广告' },
    { user_id: 'late-a', registered_at: '2026-10-10', channel: '自然' },
  ],
  activity: [
    { user_id: 'old-a', event_time: '2026-10-01' },
    { user_id: 'new-a', event_time: '2026-10-03' },
    { user_id: 'new-b', event_time: '2026-10-04' },
    { user_id: 'unknown-private-player', event_time: '2026-10-04' },
    { user_id: 'new-a', event_time: '2026-10-09' },
    { user_id: 'late-a', event_time: '2026-10-11' },
  ],
  payments: [
    { order_id: 'first', user_id: 'old-a', paid_at: '2026-10-01', amount: '1', currency: 'CNY', status: 'paid' },
    { order_id: 'second', user_id: 'old-a', paid_at: '2026-10-03', amount: '2', currency: 'CNY', status: 'paid' },
    { order_id: 'third', user_id: 'old-a', paid_at: '2026-10-04', amount: '4', currency: 'CNY', status: 'paid' },
    { order_id: 'fourth', user_id: 'new-b', paid_at: '2026-10-04', amount: '100', currency: 'CNY', status: 'paid' },
    { order_id: 'private-unknown-order', user_id: 'unknown-private-player', paid_at: '2026-10-04', amount: '1000', currency: 'CNY', status: 'paid' },
    { order_id: 'last', user_id: 'late-a', paid_at: '2026-10-11', amount: '1', currency: 'CNY', status: 'paid' },
  ],
} });

test('range analysis deduplicates period payers and attributes old-player revenue through the complete registration table', () => {
  const report = module.analyze(rangeFixture(), { now: '2026-10-13T00:00:00Z', range: { start: '2026-10-02', end: '2026-10-04' }, channels: ['自然'] });
  assert.equal(report.period, '2026-10-02 至 2026-10-04');
  assert.deepEqual(report.daily.map(day => day.date), ['2026-10-02', '2026-10-03', '2026-10-04']);
  const metric = id => report.metrics.find(item => item.id === id).value;
  assert.equal(metric('revenue'), 6);
  assert.equal(metric('arppu'), 6, '同一个人跨两日支付只计一个期间付费用户');
  assert.equal(metric('new_users'), 1);
  assert.deepEqual(report.channels.map(({ name, users, revenue }) => ({ name, users, revenue })), [{ name: '自然', users: 1, revenue: 6 }]);
  assert.equal(report.daily[0].revenue, 0, '筛后首笔订单前仍在完整支付表覆盖内');
  assert.equal(report.daily.at(-1).dau, 0, '未知与其他渠道玩家不能进入已知渠道');
  assert.ok(report.metrics.every(metric => metric.change === null));
  assert.match(report.methodology.join(' '), /派生|筛选/);
});

test('range retention observes mature cohorts beyond the selected period and keeps outside-table days null', () => {
  const report = module.analyze(rangeFixture(), { now: '2026-10-13T00:00:00Z', range: { start: '2026-09-29', end: '2026-10-02' }, channels: ['自然'] });
  assert.deepEqual(report.retention.map(cohort => cohort.date), ['2026-09-30', '2026-10-02']);
  assert.equal(report.retention.find(cohort => cohort.date === '2026-10-02').d1, 100);
  assert.equal(report.retention.find(cohort => cohort.date === '2026-10-02').d7, 100);
  assert.equal(report.daily[0].dau, null);
  assert.equal(report.daily[0].revenue, null);
  assert.equal(report.daily.at(-1).dau, 0);
  assert.throws(() => module.analyze(rangeFixture(), { now: '2026-10-10T00:00:00Z', range: { start: '2026-10-10', end: '2026-10-10' } }), /完整自然日/);
});

test('range outside registration or payment coverage keeps channel counts and payment prose unknown', () => {
  const report = module.analyze(rangeFixture(), { now: '2026-10-20T00:00:00Z', range: { start: '2026-10-12', end: '2026-10-13' }, channels: ['自然'] });
  assert.equal(report.metrics.find(metric => metric.id === 'new_users').value, null);
  assert.equal(report.channels[0].users, null);
  assert.equal(report.channels[0].revenue, null);
  assert.equal(report.findings.some(finding => /成功支付收入 0|付费人数 0/.test(finding.detail)), false);
  assert.match(report.methodology.join(' '), /所选.*自然日/);
});

test('scoped channels use the same full registration identity mapping even when events precede registration', () => {
  const data = { name: '异常时间顺序', source: 'upload', warnings: [], records: {
    users: [{ user_id: 'private-time-order-player', registered_at: '2026-10-10', channel: '自然' }],
    activity: [{ user_id: 'private-time-order-player', event_time: '2026-10-02' }],
    payments: [{ order_id: 'private-time-order-order', user_id: 'private-time-order-player', paid_at: '2026-10-02', amount: '10', currency: 'CNY', status: 'paid' }],
  } };
  const report = module.analyze(data, { now: '2026-10-13T00:00:00Z', range: { start: '2026-10-02', end: '2026-10-02' }, channels: ['自然'] });
  assert.equal(report.metrics.find(metric => metric.id === 'revenue').value, 10);
  assert.equal(report.metrics.find(metric => metric.id === 'dau').value, 1);
  assert.deepEqual(report.channels, [{ name: '自然', users: null, revenue: 10, d1: null }]);
  assert.match(report.methodology.join(' '), /标识映射/);
  assert.match(report.methodology.join(' '), /生命周期/);
  assert.match(report.quality.issues.join(' '), /早于.*注册时间/);
  assert.equal(JSON.stringify(report).includes('private-time-order'), false);
  assert.deepEqual(module.analyze(data, { now: '2026-10-04T00:00:00Z' }).channels, [], '默认分析仍保留原来只列已注册渠道的行为');
});
