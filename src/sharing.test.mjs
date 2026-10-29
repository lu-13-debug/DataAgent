import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from './api.ts';

test('公开分享令牌仅通过 POST 请求体发送，且不触发会话失效', async () => {
  assert.equal(typeof api.readShare, 'function');
  assert.equal(typeof api.visitShare, 'function');
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, options) => { calls.push({url, options}); return Response.json({ok:true}); };
    const token = 'A'.repeat(43);
    await api.readShare(token);
    await api.visitShare(token, 'B'.repeat(43));
    assert.deepEqual(calls.map(c => c.url), ['/api/public/shares/read', '/api/public/shares/visit']);
    assert.equal(JSON.parse(calls[1].options.body).visitorToken, 'B'.repeat(43));
    assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  } finally { globalThis.fetch = original; }
});

test('分享创建必须明确确认原始完整报告范围，弹窗关闭回调稳定', async () => {
  const {readFile} = await import('node:fs/promises');
  const manager = await readFile(new URL('./components/ShareManager.tsx', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('./components/ReportView.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /分享原始完整报告/);
  assert.match(manager, /不包含当前筛选/);
  assert.match(manager, /原报告期间/);
  assert.match(manager, /disabled=\{busy \|\| !!link \|\| !confirmed\}/);
  assert.match(manager, /useCallback/);
});

test('分享页根据当前会话显示明确入口且进入工作台时清除片段', async () => {
  const {readFile} = await import('node:fs/promises');
  const page = await readFile(new URL('./PublicShare.tsx', import.meta.url), 'utf8');
  assert.match(page, /api\.session\(\)/);
  assert.match(page, /进入当前工作台/);
  assert.match(page, /location\.assign\('\/'\)/);
});

test('复制链接在剪贴板缺失、同步抛错和异步拒绝时安全失败', async () => {
  const sharing = await import('./share-copy.ts').catch(() => ({}));
  assert.equal(typeof sharing.copyShareLink, 'function');
  assert.equal(await sharing.copyShareLink('link', undefined), false);
  assert.equal(await sharing.copyShareLink('link', {writeText() { throw new Error('denied'); }}), false);
  assert.equal(await sharing.copyShareLink('link', {writeText() { return Promise.reject(new Error('denied')); }}), false);
  let copied = '';
  assert.equal(await sharing.copyShareLink('link', {async writeText(value) {copied = value;}}), true);
  assert.equal(copied, 'link');
});

test('分享链接切换隔离迟到请求，非法片段清空结果，同一片段复用访客标识', async () => {
  const { createShareReader } = await import('./share-flow.ts').catch(() => ({}));
  assert.equal(typeof createShareReader, 'function');
  const pending = new Map(), visits = [], states = [];
  let count = 0;
  const reader = createShareReader({ makeVisitor: () => String(++count).repeat(43), read: token => new Promise(resolve => pending.set(token, resolve)), visit: (token, visitor) => visits.push([token, visitor]), publish: state => states.push(state) });
  const a = 'A'.repeat(43), b = 'B'.repeat(43);
  reader.open(a); reader.open(a); assert.equal(count, 1);
  reader.open(b); assert.equal(count, 2);
  pending.get(b)({title:'B'}); await Promise.resolve();
  pending.get(a)({title:'A'}); await Promise.resolve();
  assert.equal(states.at(-1).report.title, 'B');
  assert.deepEqual(visits, [[b, '2'.repeat(43)]]);
  reader.open('invalid'); assert.equal(states.at(-1).report, null); assert.equal(states.at(-1).token, 'invalid');
});

test('创建结果未知及撤销成功后刷新失败保持准确状态', async () => {
  const { createManagedShare, revokeManagedShare } = await import('./share-flow.ts').catch(() => ({}));
  assert.equal(typeof createManagedShare, 'function'); assert.equal(typeof revokeManagedShare, 'function');
  let refreshed = 0;
  const result = await createManagedShare(async () => {throw Error('lost')}, async () => {refreshed++;});
  assert.equal(result.kind, 'unknown'); assert.equal(refreshed, 1);
  let revoked = false;
  const removed = await revokeManagedShare(async () => {}, () => {revoked = true;}, async () => {throw Error('offline')});
  assert.equal(revoked, true); assert.equal(removed.kind, 'revoked-refresh-failed');
});

test('创建成功后立刻交付链接，列表刷新 401 不触发全局会话失效', async () => {
  const {createManagedShare} = await import('./share-flow.ts');
  const {onSessionExpired} = await import('./api.ts');
  const old = globalThis.fetch; let expired = 0, delivered = '', finish;
  const off = onSessionExpired(() => expired++);
  try {
    globalThis.fetch = () => new Promise(resolve => {finish = resolve;});
    const pending = createManagedShare(async () => ({token:'secret'}), () => api.shares('task').then(() => {}), value => {delivered = value.token;});
    await Promise.resolve(); await Promise.resolve();
    assert.equal(delivered, 'secret');
    finish(Response.json({error:'expired'}, {status:401}));
    const result = await pending;
    assert.equal(result.refreshFailed, true); assert.equal(expired, 0);
    globalThis.fetch = async () => Response.json({error:'expired'}, {status:401});
    await assert.rejects(api.bootstrap()); assert.equal(expired, 1);
  } finally { globalThis.fetch = old; off(); }
});

test('列表旧响应不会覆盖撤销，销毁后响应不发布', async () => {
  const {createShareListController} = await import('./share-flow.ts');
  assert.equal(typeof createShareListController, 'function');
  const pending = [], updates = [];
  const list = createShareListController(() => new Promise(resolve => pending.push(resolve)), value => updates.push(value));
  const first = list.refresh(); list.invalidate();
  const second = list.refresh(); pending[1]([{id:'one',revoked:true}]); await second;
  pending[0]([{id:'one',revoked:false}]); await first;
  assert.deepEqual(updates, [[{id:'one',revoked:true}]]);
  const third = list.refresh(); list.dispose(); pending[2]([]); await third;
  assert.equal(updates.length, 1);
});

test('分享管理所有 401 保留当前会话边界和可复制链接，其他业务仍退出', async () => {
  const {onSessionExpired} = await import('./api.ts');
  const {copyShareLink} = await import('./share-copy.ts');
  const old = globalThis.fetch; let expired = 0, copied = '';
  const off = onSessionExpired(() => expired++);
  try {
    globalThis.fetch = async () => Response.json({error:'expired'}, {status:401});
    await assert.rejects(api.shares('task'), error => error.status === 401);
    await assert.rejects(api.createShare('task', {expiresInDays:7,hideRevenue:true}), error => error.status === 401);
    await assert.rejects(api.revokeShare('share'), error => error.status === 401);
    assert.equal(expired, 0);
    assert.equal(await copyShareLink('https://example.test/share#token', {async writeText(value) {copied = value;}}), true);
    assert.equal(copied, 'https://example.test/share#token');
    await assert.rejects(api.bootstrap()); assert.equal(expired, 1);
  } finally { globalThis.fetch = old; off(); }
});

test('管理创建和撤销的 401 传回失效状态供弹窗提示', async () => {
  const { createManagedShare, revokeManagedShare } = await import('./share-flow.ts');
  const error = Object.assign(new Error('expired'), {status:401});
  const created = await createManagedShare(async () => {throw error;}, async () => {});
  assert.equal(created.error.status, 401);
  const removed = await revokeManagedShare(async () => {throw error;}, () => {}, async () => {});
  assert.equal(removed.kind, 'failed'); assert.equal(removed.error.status, 401);
});
