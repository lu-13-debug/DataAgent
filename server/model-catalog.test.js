import test from 'node:test';
import assert from 'node:assert/strict';
const catalog = await import('./model-catalog.js').catch(() => ({}));

for (const [baseUrl, expected] of [
  ['https://api.openai.com', 'https://api.openai.com/v1/models'],
  ['https://api.deepseek.com/chat/completions', 'https://api.deepseek.com/models'],
]) {
  test(`discovers a real normalized model list at ${expected}`, async () => {
    assert.equal(typeof catalog.listModels, 'function');
    const seen = [];
    const result = await catalog.listModels({ settings: { baseUrl }, key: 'catalog-private-key', fetchImpl: async (url, init) => {
      seen.push(url); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
      assert.equal(init.headers.authorization, 'Bearer catalog-private-key');
      return Response.json({ data: [{ id: 'model-b', name: '模型 B' }, { id: 'model-a' }, { id: 'model-b' }, { id: '' }, { id: 'bad\nmodel' }, { id: 'catalog-private-key' }] });
    } });
    assert.deepEqual(seen, [expected]);
    assert.deepEqual(result.models, [{ id: 'model-a', name: 'model-a' }, { id: 'model-b', name: '模型 B' }]);
    assert.equal(JSON.stringify(result).includes('catalog-private-key'), false);
  });
}

test('Claude model discovery uses versioned authentication and bounded same-endpoint pagination', async () => {
  assert.equal(typeof catalog.listModels, 'function');
  const urls = [];
  const result = await catalog.listModels({ settings: { baseUrl: 'https://api.anthropic.com/v1' }, key: 'claude-catalog-key', fetchImpl: async (url, init) => {
    urls.push(url); assert.equal(init.headers.authorization, 'Bearer claude-catalog-key'); assert.equal(init.headers['anthropic-version'], '2026-10-21');
    assert.equal(new URL(url).origin, 'https://api.anthropic.com');
    return urls.length === 1 ? Response.json({ data: [{ id: 'claude-one', display_name: 'Claude One' }], has_more: true, last_id: 'claude-one' }) : Response.json({ data: [{ id: 'claude-two', display_name: 'Claude Two' }], has_more: false });
  } });
  assert.equal(urls.length, 2); assert.equal(new URL(urls[1]).searchParams.get('after_id'), 'claude-one');
  assert.deepEqual(result.models.map(x => x.name), ['Claude One', 'Claude Two']);
});

test('model discovery reports invalid credentials, unsupported catalogs and malformed responses without secrets', async () => {
  assert.equal(typeof catalog.listModels, 'function');
  const options = { settings: { baseUrl: 'https://api.deepseek.com' }, key: 'secret-catalog-key' };
  for (const [response, pattern] of [[Response.json({ error: { message: options.key } }, { status: 401 }), /Key|凭据/], [new Response('missing', { status: 404 }), /手动|列表/], [Response.json({ choices: [] }), /列表|格式/]]) {
    await assert.rejects(catalog.listModels({ ...options, fetchImpl: async () => response }), error => pattern.test(error.message) && !error.message.includes(options.key));
  }
  await assert.rejects(catalog.listModels({ ...options, key: '', fetchImpl: async () => { throw new Error('不得调用'); } }), /Key/);
});

test('model discovery refuses oversized bodies and repeated pagination cursors', async () => {
  assert.equal(typeof catalog.listModels, 'function');
  const options = { settings: { baseUrl: 'https://api.anthropic.com/v1' }, key: 'bounded-key' };
  await assert.rejects(catalog.listModels({ ...options, fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }), /过大/);
  let calls = 0;
  await assert.rejects(catalog.listModels({ ...options, fetchImpl: async () => { calls++; return Response.json({ data: [{ id: 'same' }], has_more: true, last_id: 'same' }); } }), /分页/);
  assert.equal(calls, 2);
});

test('large model catalogs explicitly mark a capped list as partial', async () => {
  const result = await catalog.listModels({ settings: { baseUrl: 'https://api.openai.com/v1' }, key: 'large-catalog-key', fetchImpl: async () => Response.json({ data: Array.from({ length: 1001 }, (_, i) => ({ id: `model-${i}` })) }) });
  assert.equal(result.models.length, 1000);
  assert.equal(result.partial, true);
});
