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

export const validShareToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export class Accounts {
  constructor(dataDir, { now = Date.now, sessionTtlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    mkdirSync(dataDir, { recursive: true });
    this.now = now; this.sessionTtlMs = sessionTtlMs;
    this.db = new DatabaseSync(path.join(dataDir, 'accounts.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), task_id TEXT NOT NULL, snapshot TEXT NOT NULL, hide_revenue INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS shares_owner_task ON shares(owner_id,task_id);
      CREATE TABLE IF NOT EXISTS share_visits (share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE, visitor_hash TEXT NOT NULL, PRIMARY KEY(share_id,visitor_hash));
      CREATE TABLE IF NOT EXISTS share_registrations (share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE, visitor_hash TEXT NOT NULL, user_id TEXT NOT NULL UNIQUE REFERENCES users(id), PRIMARY KEY(share_id,visitor_hash));`);
    this.credentials = new Map();
    this.prune();
  }
  userByName(username) { return this.db.prepare('SELECT * FROM users WHERE username=?').get(username); }
  register(username, displayName, passwordHash, attribution = {}) {
    const user = { id: randomUUID(), username, display_name: displayName, password_hash: passwordHash, created_at: new Date(this.now()).toISOString() };
    try {
      this.db.exec('BEGIN IMMEDIATE');
      this.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(user.id, username, displayName, passwordHash, user.created_at);
      const share = this.validShare(attribution.shareToken);
      if (share && validShareToken(attribution.visitorToken) && this.db.prepare('SELECT COUNT(*) AS n FROM share_registrations WHERE share_id=?').get(share.id).n < 10000) this.db.prepare('INSERT OR IGNORE INTO share_registrations VALUES(?,?,?)').run(share.id, tokenHash(attribution.visitorToken), user.id);
      this.db.exec('COMMIT');
    }
    catch (error) { this.db.exec('ROLLBACK'); if (error.code?.includes('SQLITE_CONSTRAINT') || error.errcode === 2067) throw authError('无法注册该账号，请检查输入或改用其他用户名', 409); throw error; }
    return user;
  }
  pruneShares() { this.db.prepare('DELETE FROM shares WHERE expires_at<=?').run(this.now() - 30 * 86400000); }
  validShare(token) {
    if (!validShareToken(token)) return null;
    return this.db.prepare('SELECT * FROM shares WHERE token_hash=? AND revoked=0 AND expires_at>?').get(tokenHash(token), this.now()) || null;
  }
  createShare(ownerId, taskId, snapshot, days, hideRevenue) {
    this.pruneShares();
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM shares WHERE owner_id=?').get(ownerId).n;
    if (this.db.prepare('SELECT COUNT(*) AS n FROM shares WHERE owner_id=? AND task_id=?').get(ownerId, taskId).n >= 20) throw authError('单份报告的分享数量已达上限', 429);
    if (count >= 100) throw authError('分享数量已达上限，请等待过期记录清理', 429);
    const id = randomUUID(), token = randomBytes(32).toString('base64url'), created = this.now(), expires = created + days * 86400000;
    this.db.prepare('INSERT INTO shares VALUES(?,?,?,?,?,?,?,?,0)').run(id, tokenHash(token), ownerId, taskId, JSON.stringify(snapshot), Number(hideRevenue), created, expires);
    return { token, share: { id, expiresAt: new Date(expires).toISOString(), hideRevenue, views: 0, registrations: 0 } };
  }
  shares(ownerId, taskId) {
    this.pruneShares();
    return this.db.prepare(`SELECT s.id,s.expires_at,s.hide_revenue,s.revoked,
      (SELECT COUNT(*) FROM share_visits v WHERE v.share_id=s.id) AS views,
      (SELECT COUNT(*) FROM share_registrations r WHERE r.share_id=s.id) AS registrations
      FROM shares s WHERE s.owner_id=? AND s.task_id=? ORDER BY s.created_at DESC,s.rowid DESC`).all(ownerId, taskId).map(s => ({ id:s.id, expiresAt:new Date(s.expires_at).toISOString(), hideRevenue:Boolean(s.hide_revenue), revoked:Boolean(s.revoked), views:s.views, registrations:s.registrations }));
  }
  revokeShare(ownerId, id) { return this.db.prepare('UPDATE shares SET revoked=1 WHERE id=? AND owner_id=?').run(id, ownerId).changes > 0; }
  visitShare(share, visitor) {
    if (!validShareToken(visitor)) throw authError('访客标识无效');
    const hash = tokenHash(visitor);
    if (this.db.prepare('SELECT 1 FROM share_visits WHERE share_id=? AND visitor_hash=?').get(share.id, hash)) return;
    if (this.db.prepare('SELECT COUNT(*) AS n FROM share_visits WHERE share_id=?').get(share.id).n >= 10000) throw authError('访问计数已达上限', 429);
    this.db.prepare('INSERT OR IGNORE INTO share_visits VALUES(?,?)').run(share.id, hash);
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
  getKey(hash, baseUrl) {
    const credential = this.credentials.get(hash);
    if (!credential || credential.expiresAt <= this.now()) { this.credentials.delete(hash); return ''; }
    return baseUrl !== undefined && credential.baseUrl !== baseUrl ? '' : credential.key;
  }
  setKey(hash, key, baseUrl) {
    if (!key) { this.credentials.delete(hash); return; }
    const row = this.db.prepare('SELECT user_id,expires_at FROM sessions WHERE token_hash=?').get(hash);
    if (!row || row.expires_at <= this.now()) throw authError('登录已失效，请重新登录', 401);
    this.credentials.set(hash, { key, baseUrl, userId: row.user_id, expiresAt: row.expires_at });
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
