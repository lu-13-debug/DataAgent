import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('./task-monitor.ts').catch(() => ({}));
const task = { id: 'task-a', title: '保留的报告', status: 'running', updatedAt: '2026-10-25T10:00:00Z', createdAt: '2026-10-25T10:00:00Z', progress: 10, steps: [{ id: 'quality', status: 'completed', description: '实际描述', skillId: 'quality' }], goal: '业务目标', messages: [{ role: 'user', content: '业务背景' }], events: [], mode: 'collaborative', domain: 'game', datasetId: 'd', datasetName: '测试', currentStep: 1, useAI: false, model: '确定性', cost: 20 };
test('task summaries update state while preserving detailed evidence and never resurrect terminal tasks', () => {
  assert.equal(typeof module.mergeTaskSummaries, 'function');
  const [next] = module.mergeTaskSummaries([task], [{ ...task, status: 'completed', progress: 100, updatedAt: '2026-10-25T10:01:00Z', steps: [{ id: 'quality', status: 'completed', name: '质量' }] }]);
  assert.equal(next.goal, task.goal); assert.deepEqual(next.messages, task.messages); assert.equal(next.steps[0].description, '实际描述');
  const [stale] = module.mergeTaskSummaries([next], [{ ...task, updatedAt: '2026-10-25T10:02:00Z' }]); assert.equal(stale.status, 'completed');
  assert.equal(module.acceptTaskUpdate(next, { ...task, updatedAt: '2026-10-25T09:59:00Z' }), false);
});
test('terminal tracking ignores historical reports and notifies once after reconnect', () => {
  assert.equal(typeof module.createTerminalTracker, 'function');
  const old = { ...task, id: 'old', status: 'completed' }; const tracker = module.createTerminalTracker([old, task]);
  assert.equal(tracker.observe([old, task]).length, 0);
  const completed = { ...task, status: 'completed' };
  assert.deepEqual(tracker.observe([old, completed]).map(item => item.id), ['task-a']);
  assert.equal(tracker.observe([completed]).length, 0);
  assert.deepEqual(tracker.observe([{ ...completed, id: 'fast-task' }]).map(item => item.id), ['fast-task'], '创建后立即完成的任务也通知一次');
});
test('connection grace ends within ten seconds without treating hidden pause as disconnect', () => {
  assert.equal(typeof module.connectionExpired, 'function');
  assert.equal(module.connectionExpired(1000, 8999, false), false);
  assert.equal(module.connectionExpired(1000, 9001, false), true);
  assert.equal(module.connectionExpired(1000, 20000, true), false);
});
test('wallet snapshots stay at the newest ledger version regardless of response arrival order', () => {
  assert.equal(typeof module.mergeWalletState, 'function');
  const current = { wallet: { balance: 480, frozen: 20, spent: 0 }, walletVersion: 4 };
  const old = { wallet: { balance: 500, frozen: 0, spent: 0 }, walletVersion: 3 };
  assert.deepEqual(module.mergeWalletState(current, old), current, '延迟校准不能覆盖新任务冻结');
  assert.deepEqual(module.mergeWalletState(old, current), current, '任务详情被拒绝时也应独立接受新账本');
  assert.deepEqual(module.mergeWalletState(current, { ...old, walletVersion: 4 }), { ...old, walletVersion: 4 }, '同版快照允许再次同步');
  assert.deepEqual(module.mergeWalletState(current, { wallet: old.wallet }), current, '已获得版本后不接受无版本响应');
  assert.deepEqual(module.mergeWalletState({ wallet: old.wallet }, { wallet: current.wallet }), { wallet: current.wallet, walletVersion: undefined }, '旧服务仍兼容');
  assert.deepEqual(module.mergeWalletState(current, { ...old, walletVersion: NaN }), current);
  assert.deepEqual(module.mergeWalletState(current, { ...old, walletVersion: -1 }), current);
});
test('report metadata revisions cannot regress while task status and metadata merge independently', () => {
  const current = { ...task, status: 'completed', metadata: { favorite: true, pinned: false, tags: [], revision: 5 } };
  const [next] = module.mergeTaskDetails([current], [{ ...current, metadata: { ...current.metadata, favorite: false, revision: 4 } }]);
  assert.equal(next.metadata.revision, 5); assert.equal(next.metadata.favorite, true);
  const [freshMetadata] = module.mergeTaskDetails([current], [{ ...task, updatedAt: '2026-10-25T09:00:00Z', metadata: { ...current.metadata, pinned: true, revision: 6 } }]);
  assert.equal(freshMetadata.status, 'completed'); assert.equal(freshMetadata.updatedAt, current.updatedAt); assert.equal(freshMetadata.metadata.revision, 6); assert.equal(freshMetadata.metadata.pinned, true);
});
