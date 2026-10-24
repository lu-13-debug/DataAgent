import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Accounts, PasswordHasher, AuthRateLimiter, tokenHash } from './accounts.js';

test('scrypt uses fresh salts and bounded concurrency rejects excess queued work', async () => {
  const hasher = new PasswordHasher({ maxConcurrent: 1, maxQueue: 1 });
  const first = hasher.hash('same-password-2026'); const second = hasher.hash('same-password-2026');
  await assert.rejects(hasher.hash('same-password-2026'), error => error.status === 503);
  const [a, b] = await Promise.all([first, second]);
  assert.notEqual(a, b); assert.equal(await hasher.verify('same-password-2026', a), true); assert.equal(await hasher.verify('wrong-password-2026', a), false);
  assert.equal(await hasher.verify('same-password-2026', undefined), false);
});

test('expired API credentials are unavailable immediately and are removed from memory', async t => {
  let time = 1000000; const dir = await mkdtemp(path.join(tmpdir(), 'dataagent-accounts-'));
  const accounts = new Accounts(dir, { now: () => time, sessionTtlMs: 100 });
  t.after(async () => { accounts.close(); await rm(dir, { recursive: true, force: true }); });
  const user = accounts.register('expiry_user', '过期测试', 'hash'); const token = accounts.createSession(user.id); const hash = tokenHash(token);
  accounts.setKey(hash, 'memory-only-expiring-key'); assert.equal(accounts.getKey(hash), 'memory-only-expiring-key');
  time += 101;
  assert.equal(accounts.getKey(hash), ''); assert.equal(accounts.credentials.size, 0);
  accounts.prune(); assert.equal(accounts.session(token), null);
});

test('revoke and change password remove all affected credentials while preserving other users', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dataagent-revoke-')); const accounts = new Accounts(dir);
  t.after(async () => { accounts.close(); await rm(dir, { recursive: true, force: true }); });
  const a = accounts.register('revoke_a', '甲', 'hash'); const b = accounts.register('revoke_b', '乙', 'hash');
  const hashes = [accounts.createSession(a.id), accounts.createSession(a.id), accounts.createSession(b.id)].map(tokenHash);
  for (const hash of hashes) accounts.setKey(hash, 'temporary-key');
  accounts.revoke(hashes[0]); assert.equal(accounts.getKey(hashes[0]), '');
  accounts.changePassword(a.id, 'new-hash'); assert.equal(accounts.getKey(hashes[1]), ''); assert.equal(accounts.getKey(hashes[2]), 'temporary-key');
  assert.equal(accounts.credentials.size, 1);
});

test('username rate limits apply across IPs and expire without trusting caller identity', () => {
  let time = 0; const limiter = new AuthRateLimiter({ maxIp: 10, maxUsername: 2, windowMs: 100 }, () => time);
  limiter.consume('ip-a', 'same_user'); limiter.consume('ip-b', 'same_user');
  assert.throws(() => limiter.consume('ip-c', 'same_user'), error => error.status === 429);
  time = 101; assert.doesNotThrow(() => limiter.consume('ip-c', 'same_user'));
});
