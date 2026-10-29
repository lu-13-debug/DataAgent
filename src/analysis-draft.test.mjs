import test from 'node:test';
import assert from 'node:assert/strict';
const draft = await import('./analysis-draft.ts').catch(() => ({}));
test('titles derive from the objective and coverage while suggestions remain advisory', () => {
  assert.equal(typeof draft.suggestTitle, 'function');
  assert.match(draft.suggestTitle('检查最近7天的新玩家留存', { start: '2026-10-01', end: '2026-10-07' }), /留存/);
  assert.notEqual(draft.suggestTitle('检查付费转化'), draft.suggestTitle('检查渠道质量'));
  assert.match(draft.suggestTitle('对比版本更新前后的活跃和留存'), /版本/);
  assert.match(draft.suggestTitle('运营活动后的付费留存复盘'), /活动/);
  assert.equal(draft.goalAdvice('分析').length, 3);
  assert.equal(draft.goalAdvice('对比2026-10-01和2026-10-07的DAU与留存').length, 0);
});
test('choice memory persists only mode, dataset and AI switch and isolates accounts', () => {
  assert.equal(typeof draft.choiceKey, 'function');
  assert.notEqual(draft.choiceKey('cloud', 'a', 'https://a.example'), draft.choiceKey('cloud', 'b', 'https://a.example'));
  const memory = new Map(); const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  draft.saveChoices(storage, 'a', { mode: 'automatic', datasetId: 'test-data', useAI: false, apiKey: 'secret', goal: 'private' });
  assert.deepEqual(draft.readChoices(storage, 'a'), { mode: 'automatic', datasetId: 'test-data', useAI: false });
  assert.doesNotMatch(memory.get('a'), /secret|private/);
  assert.deepEqual(draft.readChoices({ getItem() { throw new Error('blocked'); } }, 'a'), {});
});
test('explicit prefill wins; removed datasets and unavailable AI are corrected visibly', () => {
  assert.equal(typeof draft.resolveChoices, 'function');
  const datasets = [{ id: 'a' }, { id: 'b' }];
  const chosen = draft.resolveChoices({ mode: 'automatic', datasetId: 'a', useAI: true }, datasets, true, { mode: 'collaborative', datasetId: 'b' });
  assert.equal(chosen.mode, 'collaborative'); assert.equal(chosen.datasetId, 'b');
  const corrected = draft.resolveChoices({ mode: 'automatic', datasetId: 'deleted', useAI: true }, datasets, false);
  assert.equal(corrected.datasetId, 'a'); assert.equal(corrected.useAI, false); assert.equal(corrected.corrections.length, 2);
});
