import test from 'node:test';
import assert from 'node:assert/strict';
const preview = await import('./workflow-preview.ts').catch(() => ({}));
test('approval preview explains remaining dependencies and real outputs, including missing tables', () => {
  assert.equal(typeof preview.workflowPreview, 'function');
  const task = { currentStep: 1, steps: [{ id: 'quality', name: '数据质量', status: 'completed' }, { id: 'plan', name: '分析计划', status: 'awaiting_approval' }, { id: 'monetization', name: '商业化分析', status: 'pending' }] };
  const list = preview.workflowPreview(task, { tables: [{ type: 'users' }] });
  assert.equal(list.length, 2); assert.deepEqual(list[1].missing, ['payments']); assert.match(list[1].output, /收入|ARPPU/);
});
