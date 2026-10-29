import test from 'node:test';
import assert from 'node:assert/strict';
const profiles = await import('./model-profiles.ts').catch(() => ({}));
test('model profiles persist only addresses and model names per account', () => {
  assert.equal(typeof profiles.profileKey, 'function');
  assert.notEqual(profiles.profileKey('cloud', 'a', 'https://a.example'), profiles.profileKey('cloud', 'b', 'https://a.example'));
  const memory = new Map(); const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  profiles.writeProfiles(storage, 'a', [{ baseUrl: 'https://api.deepseek.com', model: 'test-model', provider: 'DeepSeek', apiKey: 'not-to-store' }]);
  const saved = profiles.readProfiles(storage, 'a'); assert.equal(saved.length, 1); assert.equal(saved[0].model, 'test-model'); assert.equal(JSON.stringify(saved).includes('not-to-store'), false);
  profiles.writeProfiles(storage, 'bad', [{ baseUrl: 'https://user:key@example.com/?api_key=private', model: 'x' }]); assert.equal(profiles.readProfiles(storage, 'bad').length, 0);
});
test('diagnostic next actions distinguish safe model failures', () => {
  assert.equal(typeof profiles.modelDiagnosis, 'function');
  assert.match(profiles.modelDiagnosis({ code: 'INVALID_KEY' }).action, /Key/);
  assert.match(profiles.modelDiagnosis({ code: 'RATE_LIMITED' }).action, /供应商|稍后/);
  assert.match(profiles.modelDiagnosis({ code: 'REASONING_ONLY' }).action, /推理|模型/);
});
