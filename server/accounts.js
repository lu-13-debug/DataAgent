import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const params = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const authError = (message, status = 400) => Object.assign(new Error(message), { status });
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export const publicUser = row => ({ id: row.id, username: row.username, displayName: row.display_name, createdAt: row.created_at });
export function usernameValue(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(value)) throw authError('用户名须为 3–32 个英文字母、数字或下划线');
  return value.toLowerCase();
}
export function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) throw authError('密码须为 10–128 个字符');
  return value;
}

// Bound both memory-intensive scrypt operations and their waiting queue.
export class PasswordHasher {
  constructor({ maxConcurrent = 2, maxQueue = 16 } = {}) { this.active = 0; this.queue = []; this.maxConcurrent = maxConcurrent; this.maxQueue = maxQueue; }
  async run(fn) {
    if (this.active >= this.maxConcurrent) {
      if (this.queue.length >= this.maxQueue) throw authError('认证服务繁忙，请稍后重试', 503);
      await new Promise(resolve => this.queue.push(resolve));
    } else this.active++;
    try { return await fn(); }
    finally { const next = this.queue.shift(); if (next) next(); else this.active--; }
  }
  async hash(password) {
    return this.run(async () => {
      const salt = randomBytes(16); const hash = await derive(password, salt, 32, params);
      return `scrypt$32768$8$3$${salt.toString('hex')}$${hash.toString('hex')}`;
    });
  }
  async verify(password, encoded) {
    return this.run(async () => {
      const parts = encoded?.split('$');
      const valid = parts?.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$32768$8$3' && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{64}$/.test(parts[5]);
      // Unknown users still incur the same KDF work and constant-time comparison.
      const salt = valid ? Buffer.from(parts[4], 'hex') : Buffer.alloc(16);
      const expected = valid ? Buffer.from(parts[5], 'hex') : Buffer.alloc(32);
      const actual = await derive(password, salt, 32, params);
      return timingSafeEqual(actual, expected) && Boolean(valid);
    });
  }
}

export class Accounts {
  constructor(dataDir, { now = Date.now, sessionTtlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    mkdirSync(dataDir, { recursive: true });
    this.now = now; this.sessionTtlMs = sessionTtlMs;
    this.db = new DatabaseSync(path.join(dataDir, 'accounts.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);`);
    this.credentials = new Map();
    this.prune();
  }
  userByName(username) { return this.db.prepare('SELECT * FROM users WHERE username=?').get(username); }
  register(username, displayName, passwordHash) {
    const user = { id: randomUUID(), username, display_name: displayName, password_hash: passwordHash, created_at: new Date(this.now()).toISOString() };
    try { this.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(user.id, username, displayName, passwordHash, user.created_at); }
    catch (error) { if (error.code?.includes('SQLITE_CONSTRAINT') || error.errcode === 2067) throw authError('无法注册该账号，请检查输入或改用其他用户名', 409); throw error; }
    return user;
  }
  createSession(userId) {
    this.prune();
    // A bounded number of live sessions also bounds in-memory credentials per account.
    const old = this.db.prepare('SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 19').all(userId);
    for (const row of old) this.revoke(row.token_hash);
    const token = randomBytes(32).toString('base64url'); const hash = tokenHash(token);
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash, userId, this.now() + this.sessionTtlMs, this.now());
    return token;
  }
  session(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = tokenHash(token);
    const row = this.db.prepare('SELECT s.token_hash,s.expires_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(hash);
    if (!row) return null;
    if (row.expires_at <= this.now()) { this.revoke(hash); return null; }
    return { hash, user: publicUser(row), passwordHash: row.password_hash };
  }
  getKey(hash) {
    const credential = this.credentials.get(hash);
    if (!credential || credential.expiresAt <= this.now()) { this.credentials.delete(hash); return ''; }
    return credential.key;
  }
  setKey(hash, key) {
    if (!key) { this.credentials.delete(hash); return; }
    const row = this.db.prepare('SELECT user_id,expires_at FROM sessions WHERE token_hash=?').get(hash);
    if (!row || row.expires_at <= this.now()) throw authError('登录已失效，请重新登录', 401);
    this.credentials.set(hash, { key, userId: row.user_id, expiresAt: row.expires_at });
  }
  revoke(hash) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash); this.credentials.delete(hash); }
  changePassword(userId, passwordHash) {
    this.db.exec('BEGIN IMMEDIATE');
    try { this.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, userId); this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    for (const [hash, credential] of this.credentials) if (credential.userId === userId) this.credentials.delete(hash);
  }
  prune() {
    const now = this.now(); this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    for (const [hash, credential] of this.credentials) if (credential.expiresAt <= now) this.credentials.delete(hash);
  }
  close() { this.credentials.clear(); this.db.close(); }
}

export class AuthRateLimiter {
  constructor({ windowMs = 15 * 60 * 1000, maxIp = 40, maxUsername = 12, maxEntries = 10000 } = {}, now = Date.now) {
    this.entries = new Map(); this.windowMs = windowMs; this.maxIp = maxIp; this.maxUsername = maxUsername; this.maxEntries = maxEntries; this.now = now;
  }
  consume(ip, username) {
    const now = this.now();
    for (const [key, value] of this.entries) if (value.until <= now) this.entries.delete(key);
    const keys = [[`ip:${ip}`, this.maxIp], [`user:${username}`, this.maxUsername]];
    for (const [key, max] of keys) {
      const entry = this.entries.get(key);
      if ((entry?.count || 0) >= max || (!entry && this.entries.size >= this.maxEntries)) throw authError('尝试次数过多，请稍后再试', 429);
    }
    for (const [key] of keys) { const value = this.entries.get(key) || { count: 0, until: now + this.windowMs }; value.count++; this.entries.set(key, value); }
  }
}
