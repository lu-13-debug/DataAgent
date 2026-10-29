import test from 'node:test';
import assert from 'node:assert/strict';
const templates = await import('./analysis-templates.ts').catch(() => ({}));
test('five templates declare required tables and never invent availability', () => {
  assert.equal(templates.analysisTemplates?.length, 5);
  const payment = templates.analysisTemplates.find(template => template.id === 'payment');
  assert.deepEqual(templates.templateAvailability(payment, [{ id: 'a', tables: [{ type: 'users' }, { type: 'activity' }] }]).missing, ['payments']);
  const dataset = { id: 'b', source: 'upload', tables: ['users', 'activity', 'payments'].map(type => ({ type })) };
  assert.equal(templates.templateAvailability(payment, [dataset]).dataset.id, 'b');
  assert.match(templates.templateGoal(payment, { dateRange: { start: '2026-10-01', end: '2026-10-07' } }), /2026-10-01/);
});
