import test from 'node:test';
import assert from 'node:assert/strict';
const cost = await import('./model-cost.ts').catch(() => ({}));
test('cost estimates require reported input/output usage and explicit valid rates', () => {
  assert.equal(typeof cost.estimateModelCost, 'function');
  assert.equal(cost.estimateModelCost(undefined, { input: 1, output: 2 }), null);
  assert.equal(cost.estimateModelCost({ protocol: 'chat-completions', inputTokens: 10, outputTokens: null }, { input: 1, output: 2 }), null);
  assert.equal(cost.estimateModelCost({ protocol: 'chat-completions', inputTokens: 10, outputTokens: 7 }, { input: 1, output: 2 }), .000024);
  assert.equal(cost.estimateModelCost({ protocol: 'anthropic', inputTokens: 10, outputTokens: 7, cacheReadInputTokens: 20, cacheCreationInputTokens: 0 }, { input: 1, output: 2 }), .000044);
  assert.equal(cost.estimateModelCost({ protocol: 'chat-completions', inputTokens: 100, outputTokens: 100 }, { input: Number.MAX_VALUE, output: 1 }), null);
});
