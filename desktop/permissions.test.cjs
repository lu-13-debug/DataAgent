const test = require('node:test');
const assert = require('node:assert/strict');
let create; try { create = require('./permissions.cjs').createNotificationPolicy; } catch {}
test('notification permission needs consent on the connected main frame; every other capability stays denied', async () => {
  assert.equal(typeof create, 'function');
  let origin = 'https://service.example'; let prompts = 0; const contents = { getURL: () => origin + '/', isDestroyed: () => false };
  const policy = create({ getOrigin: () => origin, getContents: () => contents, confirm: async () => { prompts++; return true; } });
  assert.equal(policy.check(contents, 'notifications', origin, { isMainFrame: true }), false);
  let granted; await policy.request(contents, 'notifications', value => { granted = value; }, { isMainFrame: true, requestingUrl: origin + '/' });
  assert.equal(granted, true); assert.equal(prompts, 1); assert.equal(policy.check(null, 'notifications', origin, {}), true);
  assert.equal(policy.check(contents, 'media', origin, { isMainFrame: true }), false);
  assert.equal(policy.check(contents, 'notifications', 'https://evil.example', { isMainFrame: true }), false);
  assert.equal(policy.check(contents, 'notifications', origin, { isMainFrame: false }), false);
  await policy.request(contents, 'notifications', value => { granted = value; }, { isMainFrame: false, requestingUrl: origin }); assert.equal(granted, false); assert.equal(prompts, 1);
  origin = 'https://other.example'; assert.equal(policy.check(null, 'notifications', origin, {}), false);
});
test('refused notification consent and a connection changed during consent never grant', async () => {
  assert.equal(typeof create, 'function');
  let origin = 'https://one.example'; const contents = { getURL: () => origin, isDestroyed: () => false };
  const denied = create({ getOrigin: () => origin, getContents: () => contents, confirm: async () => false });
  let granted; await denied.request(contents, 'notifications', value => { granted = value; }, { isMainFrame: true, requestingUrl: origin }); assert.equal(granted, false);
  const changed = create({ getOrigin: () => origin, getContents: () => contents, confirm: async () => { origin = 'https://two.example'; return true; } });
  await changed.request(contents, 'notifications', value => { granted = value; }, { isMainFrame: true, requestingUrl: 'https://one.example' }); assert.equal(granted, false);
});
