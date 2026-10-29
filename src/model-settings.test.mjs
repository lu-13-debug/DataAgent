import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from './api.ts';

test('model discovery sends credentials in an authenticated POST body without persisting settings', async () => {
  assert.equal(typeof api.models, 'function');
  const previous = globalThis.fetch;
  try {
    let captured;
    globalThis.fetch = async (url, options) => { captured = { url, options }; return Response.json({ models: [{ id: 'model-one', name: '模型一' }], baseUrl: 'https://api.deepseek.com', partial: false }); };
    const controller = new AbortController();
    const result = await api.models({ baseUrl: 'https://api.deepseek.com', apiKey: 'request-only-key' }, controller.signal);
    assert.equal(result.models[0].id, 'model-one');
    assert.equal(captured.url, '/api/settings/models'); assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.credentials, 'same-origin'); assert.ok(captured.options.signal instanceof AbortSignal);
    assert.equal(captured.options.signal.aborted, false); controller.abort();
    assert.equal(captured.options.signal.aborted, true); assert.equal(captured.options.signal.reason, controller.signal.reason);
    assert.deepEqual(JSON.parse(captured.options.body), { baseUrl: 'https://api.deepseek.com', apiKey: 'request-only-key' });
  } finally { globalThis.fetch = previous; }
});
