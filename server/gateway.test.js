import test from 'node:test';
import assert from 'node:assert/strict';
import { chat, validateSettings } from './gateway.js';

for (const [name, baseUrl, tokenField] of [
  ['OpenAI', 'https://api.openai.com/v1', 'max_completion_tokens'],
  ['DeepSeek', 'https://api.deepseek.com', 'max_tokens'],
]) {
  test(`${name} uses the official endpoint without forcing unsupported sampling parameters`, async () => {
    let captured;
    const messages = [{ role: 'user', content: '分析聚合数据' }];
    const result = await chat({ settings: { baseUrl, model: 'my-authorized-model' }, key: 'test-memory-key', messages, maxTokens: 1200,
      fetchImpl: async (url, init) => {
        captured = { url, ...init, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({ choices: [{ message: { content: '已分析' } }] }));
      },
    });
    assert.equal(result, '已分析');
    assert.equal(captured.url, `${baseUrl}/chat/completions`);
    assert.equal(captured.redirect, 'error');
    assert.equal(captured.headers.authorization, 'Bearer test-memory-key');
    assert.deepEqual(captured.body, { model: 'my-authorized-model', messages, [tokenField]: 1200 });
  });
}

test('official Claude uses Messages with separated system prompt and API headers', async () => {
  let request;
  const result = await chat({ settings: { baseUrl: 'https://api.anthropic.com/v1', model: 'my-authorized-model' }, key: 'test-memory-key', maxTokens: 1200, messages: [{ role: 'system', content: '聚合数据分析' }, { role: 'user', content: '请总结' }], fetchImpl: async (url, init) => {
    request = { url, headers: init.headers, body: JSON.parse(init.body) };
    return Response.json({ type: 'message', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '已分析' }], stop_reason: 'end_turn' });
  } });
  assert.equal(result, '已分析'); assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.headers['x-api-key'], 'test-memory-key'); assert.ok(request.headers['anthropic-version']);
  assert.equal(request.body.system, '聚合数据分析'); assert.deepEqual(request.body.messages, [{ role: 'user', content: '请总结' }]);
});

test('provider usage contains only reported numeric counters and never arbitrary fields', async () => {
  let usage;
  const result = await chat({ settings: { baseUrl: 'https://api.deepseek.com', model: 'test-model' }, key: 'private-key', messages: [{ role: 'user', content: 'OK' }], onUsage: value => { usage = value; }, fetchImpl: async () => Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 3 }, secret: 'private-key', total_tokens: 'fake' } }) });
  assert.equal(result, 'OK'); assert.equal(usage.inputTokens, 10); assert.equal(usage.outputTokens, 7); assert.equal(usage.totalTokens, null); assert.equal(usage.cacheReadInputTokens, 2); assert.equal(usage.reasoningTokens, 3); assert.equal(JSON.stringify(usage).includes('private-key'), false);
  let absent = 'not-called';
  await chat({ settings: { baseUrl: 'https://api.deepseek.com', model: 'test-model' }, key: 'x', messages: [], onUsage: value => { absent = value; }, fetchImpl: async () => Response.json({ choices: [{ message: { content: 'OK' } }] }) });
  assert.equal(absent, null);
});

for (const [status, code] of [[401, 'INVALID_KEY'], [403, 'NO_PERMISSION'], [429, 'RATE_LIMITED'], [404, 'MODEL_UNSUPPORTED']]) {
  test(`model HTTP ${status} produces safe actionable diagnostic ${code}`, async () => {
    await assert.rejects(chat({ settings: { baseUrl: 'https://api.deepseek.com', model: 'test-model' }, key: 'do-not-echo', messages: [], fetchImpl: async () => Response.json({ error: { message: 'do-not-echo provider-private' } }, { status }) }), error => {
      assert.equal(error.code, code); assert.equal(error.message.includes('do-not-echo'), false); assert.equal(error.message.includes('provider-private'), false); assert.match(error.message, /请|稍后/); return true;
    });
  });
}

test('normalizes official root URLs and full chat endpoints into a usable base', () => {
  assert.equal(validateSettings({ baseUrl: 'https://api.openai.com/' }).baseUrl, 'https://api.openai.com/v1');
  assert.equal(validateSettings({ baseUrl: 'https://api.anthropic.com' }).baseUrl, 'https://api.anthropic.com/v1');
  assert.equal(validateSettings({ baseUrl: 'https://api.deepseek.com/chat/completions/' }).baseUrl, 'https://api.deepseek.com');
  assert.equal(validateSettings({ baseUrl: 'https://gateway.example.test/custom/v1/models' }).baseUrl, 'https://gateway.example.test/custom/v1');
});

const completion = (message, finish_reason = 'stop') => async () => Response.json({ choices: [{ message, finish_reason }] });
const chatOptions = { settings: { baseUrl: 'https://api.deepseek.com', model: 'reasoning-model' }, key: 'regression-key', messages: [{ role: 'user', content: 'OK' }] };

test('reads visible text blocks without leaking thinking blocks', async () => {
  const result = await chat({ ...chatOptions, fetchImpl: completion({ content: [{ type: 'text', text: '连' }, { type: 'thinking', thinking: 'private reasoning' }, { type: 'output_text', text: '接成功' }] }) });
  assert.equal(result, '连接成功');
});

test('DeepSeek Flash connection testing disables thinking so its short check can return final text', async () => {
  let body;
  const result = await chat({ ...chatOptions, settings: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }, connectionTest: true, maxTokens: 1024, fetchImpl: async (_url, init) => {
    body = JSON.parse(init.body);
    return completion({ content: body.thinking?.type === 'disabled' ? 'OK' : null, reasoning_content: 'private' }, body.thinking?.type === 'disabled' ? 'stop' : 'length')();
  } });
  assert.equal(result, 'OK');
  assert.deepEqual(body.thinking, { type: 'disabled' });
});

test('connection probe recognizes reasoning-only responses but reports still require a final answer', async () => {
  const fetchImpl = completion({ content: null, reasoning_content: 'private reasoning must not reach UI' }, 'length');
  assert.equal(await chat({ ...chatOptions, connectionTest: true, fetchImpl }), '');
  await assert.rejects(chat({ ...chatOptions, fetchImpl }), /输出上限|推理/);
});

test('reports reject truncated final answers and connection probes do not accept truly empty replies', async () => {
  await assert.rejects(chat({ ...chatOptions, fetchImpl: completion({ content: '{"summary":"unfinished' }, 'length') }), /截断|输出上限/);
  await assert.rejects(chat({ ...chatOptions, connectionTest: true, fetchImpl: completion({ content: null }) }), /为空|最终文本/);
  await assert.rejects(chat({ ...chatOptions, connectionTest: true, fetchImpl: completion({ content: null, refusal: 'private refusal' }, 'content_filter') }), /拒绝|安全/);
});
