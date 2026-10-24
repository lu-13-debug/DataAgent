const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const path = require('node:path');
const runtime = require('./runtime.cjs');

test('云端根地址支持 HTTPS 和严格环回 HTTP', () => {
  assert.equal(typeof runtime.normalizeServerUrl, 'function', '需要服务地址校验器');
  for (const [input, expected] of [
    [' https://DATA.example:443/ ', 'https://data.example'],
    ['http://localhost:3002', 'http://localhost:3002'],
    ['http://127.0.0.1:3002/', 'http://127.0.0.1:3002'],
    ['http://[::1]:3002', 'http://[::1]:3002'],
  ]) assert.equal(runtime.normalizeServerUrl(input), expected);
});
test('拒绝公网 HTTP、凭据、路径、查询、片段和不明确的地址语法', () => {
  assert.equal(typeof runtime.normalizeServerUrl, 'function');
  for (const value of ['', null, {}, 'http://example.com', 'http://127.0.0.2', 'http://2130706433', 'http://127.1', 'http://localhost.example', 'https://user:pass@example.com', 'https://user@example.com', 'https://example.com/api', 'https://example.com/../', 'https://example.com/?', 'https://example.com/#', 'https://example.com\\evil', 'https://example.com\n/','file:///tmp/service', 'javascript:alert(1)', 'https:example.com']) {
    assert.throws(() => runtime.normalizeServerUrl(value), { name: 'Error' }, String(value));
  }
});
test('管理员环境优先于用户配置，用户配置优先于安装包默认，空默认允许首次连接', () => {
  assert.equal(typeof runtime.resolveServerUrl, 'function');
  assert.equal(runtime.resolveServerUrl({ environmentUrl: 'https://admin.example', savedUrl: 'https://saved.example', bundledUrl: 'https://bundle.example' }), 'https://admin.example');
  assert.equal(runtime.resolveServerUrl({ savedUrl: 'https://saved.example', bundledUrl: 'https://bundle.example' }), 'https://saved.example');
  assert.equal(runtime.resolveServerUrl({ bundledUrl: 'https://bundle.example/' }), 'https://bundle.example');
  assert.equal(runtime.resolveServerUrl({ bundledUrl: '' }), null);
  assert.throws(() => runtime.resolveServerUrl({ savedUrl: 'http://evil.example', bundledUrl: 'https://bundle.example' }));
});
test('高优先级配置不受更低优先级文件损坏影响', async () => {
  assert.equal(typeof runtime.loadServerUrl, 'function', '配置加载应按优先级延迟读取');
  const directory = await mkdtemp(path.join(__dirname, 'config-fixture-'));
  const connectionFile = path.join(directory, 'connection.json');
  const bundledFile = path.join(directory, 'cloud-config.json');
  try {
    await writeFile(connectionFile, '{broken');
    await writeFile(bundledFile, '{broken');
    assert.equal(await runtime.loadServerUrl({ environmentUrl: 'https://admin.example', connectionFile, bundledFile }), 'https://admin.example');
    await writeFile(connectionFile, JSON.stringify({ serverUrl: 'https://saved.example' }));
    assert.equal(await runtime.loadServerUrl({ connectionFile, bundledFile }), 'https://saved.example');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('只有当前连接窗口的本地主框架可以调用连接 IPC', () => {
  assert.equal(typeof runtime.isConnectionSender, 'function');
  const url = 'file:///D:/app/desktop/connection.html';
  const frame = { url };
  const contents = { mainFrame: frame };
  assert.equal(runtime.isConnectionSender({ sender: contents, senderFrame: frame }, contents, url), true);
  assert.equal(runtime.isConnectionSender({ sender: {}, senderFrame: frame }, contents, url), false);
  assert.equal(runtime.isConnectionSender({ sender: contents, senderFrame: { url } }, contents, url), false);
  assert.equal(runtime.isConnectionSender({ sender: contents, senderFrame: { url: 'https://cloud.example' } }, contents, url), false);
  frame.url = url + '?injected';
  assert.equal(runtime.isConnectionSender({ sender: contents, senderFrame: frame }, contents, url), false);
  assert.equal(runtime.isConnectionSender({}, null, url), false);
});
test('服务探测必须识别云端账号服务并禁止跟随重定向', async () => {
  assert.equal(typeof runtime.probeCloudServer, 'function');
  let request;
  const fetchImpl = async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ mode: 'cloud', authRequired: true, serviceName: 'DataAgent' }) }; };
  assert.equal(await runtime.probeCloudServer('https://cloud.example/', fetchImpl), 'https://cloud.example');
  assert.equal(request.url, 'https://cloud.example/api/runtime');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.credentials, 'omit');
  assert.ok(request.options.signal instanceof AbortSignal);
  for (const body of [{ mode: 'local', authRequired: false, serviceName: 'DataAgent' }, { mode: 'cloud', authRequired: false, serviceName: 'DataAgent' }, { mode: 'cloud', authRequired: true, serviceName: 'Other' }]) {
    await assert.rejects(runtime.probeCloudServer('https://cloud.example', async () => ({ ok: true, json: async () => body })), /云端账号/);
  }
  await assert.rejects(runtime.probeCloudServer('https://cloud.example', async () => ({ ok: false, status: 503 })), /503/);
});
test('连接文件仅在探测通过后写入且只保存非敏感服务地址', async () => {
  assert.equal(typeof runtime.saveCloudConnection, 'function');
  const directory = await mkdtemp(path.join(__dirname, 'connection-fixture-'));
  const file = path.join(directory, 'connection.json');
  try {
    await assert.rejects(runtime.saveCloudConnection(file, 'https://bad.example', async () => ({ ok: true, json: async () => ({ mode: 'local' }) })));
    await assert.rejects(readFile(file), { code: 'ENOENT' });
    await runtime.saveCloudConnection(file, 'https://cloud.example/', async () => ({ ok: true, json: async () => ({ mode: 'cloud', authRequired: true, serviceName: 'DataAgent' }) }));
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { serverUrl: 'https://cloud.example' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
