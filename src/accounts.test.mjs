import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from './api.ts';

test('注册校验接受中文显示名、大小写用户名和保留空格的密码', async () => {
  const validation = await import('./account-validation.ts').catch(() => ({}));
  assert.equal(typeof validation.registrationError, 'function', '应提供注册输入校验');
  assert.equal(validation.registrationError({ username: 'Player_01', displayName: '运营小组', password: '  secret1234  ', confirmPassword: '  secret1234  ' }), '');
  assert.match(validation.registrationError({ username: 'ab', displayName: '运营', password: '1234567890', confirmPassword: '1234567890' }), /用户名/);
  assert.match(validation.registrationError({ username: 'player', displayName: '运营', password: '1234567890', confirmPassword: '1234567890 ' }), /一致/);
  assert.match(validation.registrationError({ username: 'player', displayName: '运营', password: 'a'.repeat(129), confirmPassword: 'a'.repeat(129) }), /10.*128/);
});

test('修改密码校验要求原密码且确认密码逐字匹配', async () => {
  const validation = await import('./account-validation.ts').catch(() => ({}));
  assert.equal(typeof validation.passwordChangeError, 'function', '应提供修改密码校验');
  assert.match(validation.passwordChangeError('', '1234567890', '1234567890'), /当前密码/);
  assert.match(validation.passwordChangeError('old-secret', '1234567890', '1234567890 '), /一致/);
  assert.equal(validation.passwordChangeError('old-secret', ' 12345678 ', ' 12345678 '), '');
});

test('认证 API 使用同源 Cookie 并保留密码原始内容', async () => {
  assert.equal(typeof api.register, 'function', '应提供真实注册 API');
  const previous = globalThis.fetch;
  try {
    let captured;
    globalThis.fetch = async (url, options) => { captured = { url, options }; return Response.json({ user: { id: 'one' } }, { status: 201 }); };
    const result = await api.register({ username: 'player', displayName: '运营', password: ' 12345678 ' });
    assert.equal(result.user.id, 'one');
    assert.equal(captured.url, '/api/auth/register');
    assert.equal(captured.options.credentials, 'same-origin');
    assert.equal(JSON.parse(captured.options.body).password, ' 12345678 ');
  } finally { globalThis.fetch = previous; }
});

test('只有业务 401 通知会话失效，认证表单错误不清除会话', async () => {
  const module = await import('./api.ts');
  assert.equal(typeof module.onSessionExpired, 'function', '应提供业务会话失效通知');
  const previous = globalThis.fetch;
  let expired = 0;
  const unsubscribe = module.onSessionExpired(() => expired++);
  try {
    globalThis.fetch = async () => Response.json({ error: '用户名或密码不正确' }, { status: 401 });
    await assert.rejects(api.login({ username: 'player', password: 'incorrect!' }), /用户名或密码/);
    assert.equal(expired, 0);
    await assert.rejects(api.bootstrap());
    assert.equal(expired, 1);
    unsubscribe();
    await assert.rejects(api.bootstrap());
    assert.equal(expired, 1);
  } finally { unsubscribe(); globalThis.fetch = previous; }
});

test('切换会话后，旧请求的迟到 401 不影响新账号', async () => {
  const module = await import('./api.ts');
  assert.equal(typeof module.resetSessionBoundary, 'function', '应隔离切换账号前的未完成请求');
  const previous = globalThis.fetch;
  let finish;
  let expired = 0;
  const unsubscribe = module.onSessionExpired(() => expired++);
  try {
    globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
    const request = api.bootstrap();
    module.resetSessionBoundary();
    finish(Response.json({ error: '登录已失效' }, { status: 401 }));
    await assert.rejects(request);
    assert.equal(expired, 0);
  } finally { unsubscribe(); globalThis.fetch = previous; }
});

test('报告下载读取 Markdown，且下载的 401 也触发会话失效', async () => {
  const module = await import('./api.ts');
  assert.equal(typeof api.report, 'function', '报告下载应通过统一 API 边界');
  const previous = globalThis.fetch;
  let expired = 0;
  const unsubscribe = module.onSessionExpired(() => expired++);
  try {
    globalThis.fetch = async (path, options) => { assert.equal(path, '/api/tasks/task-one/report.md'); assert.equal(options.credentials, 'same-origin'); return new Response('# 我的报告\n', { headers: { 'Content-Type': 'text/markdown' } }); };
    assert.equal(await api.report('task-one'), '# 我的报告\n');
    globalThis.fetch = async () => Response.json({ error: '请重新登录' }, { status: 401 });
    await assert.rejects(api.report('task-one'), /请重新登录/);
    assert.equal(expired, 1);
  } finally { unsubscribe(); globalThis.fetch = previous; }
});
test('task mutations have bounded requests and timeout never claims cancellation or retries a charge', async t => {
  const previous = globalThis.fetch; let calls = 0;
  t.mock.method(AbortSignal, 'timeout', duration => {
    assert.ok(duration > 0 && duration <= 30000);
    return AbortSignal.abort(new DOMException('Controlled timeout', 'TimeoutError'));
  });
  try {
    globalThis.fetch = async (_url, options) => {
      calls++; assert.ok(options.signal instanceof AbortSignal, '收费操作也必须有超时信号');
      options.signal.throwIfAborted();
      return new Response('{}');
    };
    await assert.rejects(api.retry('task-a', { strategy: 'resume', useAI: false, clientRequestId: 'stable-retry' }), /超时.*可能已处理/);
    assert.equal(calls, 1, '不自动重试收费请求');
  } finally { globalThis.fetch = previous; }
});
