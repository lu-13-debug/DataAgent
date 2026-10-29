import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function assertId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
    const error = new Error('无效的资源 ID'); error.status = 400; throw error;
  }
}

export class Store {
  constructor(dataDir) {
    this.listeners = new Set(); this.inTransaction = false; this.pendingChange = false; this.version = 0;
    // User supplied resource IDs are SQL parameters; never used to form filesystem paths.
    const root = path.resolve(dataDir);
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(path.join(root, 'dataagent.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS entities (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet (id INTEGER PRIMARY KEY CHECK(id=1), balance INTEGER NOT NULL, frozen INTEGER NOT NULL, spent INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations (task_id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, type TEXT NOT NULL, amount INTEGER NOT NULL, task_id TEXT, description TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS unique_task_transaction ON transactions(task_id,type) WHERE task_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS unique_task_request ON entities(json_extract(body,'$.clientRequestId'))
        WHERE kind='task' AND json_extract(body,'$.clientRequestId') IS NOT NULL;
      CREATE INDEX IF NOT EXISTS task_status ON entities(kind,json_extract(body,'$.status'));`);
    if (!this.db.prepare('SELECT 1 FROM wallet').get()) this.atomic(() => {
      this.db.prepare('INSERT INTO wallet VALUES(1,500,0,0)').run();
      this.transaction('grant', 500, undefined, '本地试用额度赠送');
    });
  }
  atomic(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    this.inTransaction = true; this.pendingChange = false;
    try {
      const result = fn(); this.db.exec('COMMIT'); this.inTransaction = false;
      const changed = this.pendingChange; this.pendingChange = false; if (changed) this.changed();
      return result;
    }
    catch (error) { this.db.exec('ROLLBACK'); this.inTransaction = false; this.pendingChange = false; throw error; }
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed() {
    if (this.inTransaction) { this.pendingChange = true; return; }
    this.version++;
    for (const listener of this.listeners) { try { listener(this.version); } catch { /* A disconnected observer must not roll back committed work. */ } }
  }
  get(kind, id) { assertId(id); const row = this.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(row.body) : null; }
  list(kind) { return this.db.prepare('SELECT body FROM entities WHERE kind=? ORDER BY rowid DESC').all(kind).map(x => JSON.parse(x.body)); }
  put(kind, value) { assertId(value.id); this.db.prepare('INSERT INTO entities(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, value.id, JSON.stringify(value)); if (kind === 'task') this.changed(); return value; }
  delete(kind, id) { assertId(id); this.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, id); if (kind === 'task') this.changed(); }
  monitorTasks(limit = 100) {
    // Drop large payloads in SQLite before allocating any JS report/message objects.
    return this.db.prepare(`SELECT json_remove(body,'$.report','$.messages','$.events','$.goal','$._analysis') AS body FROM entities
      WHERE kind='task' AND id IN
        (SELECT id FROM (SELECT id FROM entities WHERE kind='task' ORDER BY rowid DESC LIMIT ?)
          UNION SELECT id FROM entities WHERE kind='task' AND json_extract(body,'$.status') IN ('running','awaiting_approval'))
      ORDER BY rowid DESC`).all(limit).map(row => JSON.parse(row.body));
  }
  taskByRequestId(id) { const row = this.db.prepare("SELECT body FROM entities WHERE kind='task' AND json_extract(body,'$.clientRequestId')=? LIMIT 1").get(id); return row ? JSON.parse(row.body) : null; }
  config(key, value) {
    if (value === undefined) { const row = this.db.prepare('SELECT body FROM config WHERE key=?').get(key); return row ? JSON.parse(row.body) : null; }
    this.db.prepare('INSERT INTO config VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key, JSON.stringify(value));
    return value;
  }
  wallet() { const row = this.db.prepare('SELECT balance,frozen,spent FROM wallet WHERE id=1').get(); return { ...row }; }
  walletVersion() { return this.db.prepare('SELECT COALESCE(MAX(rowid),0) AS version FROM transactions').get().version; }
  walletSnapshot() {
    // One SQLite read snapshot binds the counters to the latest committed ledger entry.
    const { walletVersion, ...wallet } = this.db.prepare(`SELECT balance,frozen,spent,
      (SELECT COALESCE(MAX(rowid),0) FROM transactions) AS walletVersion FROM wallet WHERE id=1`).get();
    return { wallet, walletVersion };
  }
  transactions() { return this.db.prepare('SELECT * FROM transactions ORDER BY rowid DESC').all().map(x => ({ id: x.id, type: x.type, amount: x.amount, ...(x.task_id ? { taskId: x.task_id } : {}), description: x.description, createdAt: x.created_at })); }
  transaction(type, amount, taskId, description) { this.db.prepare('INSERT INTO transactions VALUES(?,?,?,?,?,?)').run(randomUUID(), type, amount, taskId || null, description, new Date().toISOString()); }
  createTask(task) {
    return this.atomic(() => {
      if (task.clientRequestId) {
        const previous = this.taskByRequestId(task.clientRequestId);
        if (previous) {
          if (previous._requestFingerprint !== task._requestFingerprint) throw Object.assign(new Error('此请求编号已用于不同输入，请使用新的 clientRequestId'), { status: 409 });
          return previous;
        }
      }
      const updated = this.db.prepare('UPDATE wallet SET balance=balance-20,frozen=frozen+20 WHERE id=1 AND balance>=20').run();
      if (!updated.changes) { const error = new Error('可用试用额度不足，每次任务需要 20 额度'); error.status = 402; throw error; }
      this.db.prepare('INSERT INTO reservations VALUES(?,?)').run(task.id, 'frozen');
      this.transaction('freeze', 20, task.id, '分析任务冻结 20 试用额度');
      this.put('task', task); return task;
    });
  }
  finish(task, success) {
    return this.atomic(() => {
      const reservation = this.db.prepare('SELECT state FROM reservations WHERE task_id=?').get(task.id);
      if (reservation?.state === 'frozen') {
        this.db.prepare('UPDATE reservations SET state=? WHERE task_id=?').run(success ? 'settled' : 'released', task.id);
        if (success) this.db.prepare('UPDATE wallet SET frozen=frozen-20,spent=spent+20 WHERE id=1').run();
        else this.db.prepare('UPDATE wallet SET frozen=frozen-20,balance=balance+20 WHERE id=1').run();
        this.transaction(success ? 'settle' : 'release', 20, task.id, success ? '任务成功，结算 20 试用额度' : '任务未完成，释放 20 试用额度');
      }
      this.put('task', task); return task;
    });
  }
  close() { this.listeners.clear(); this.db.close(); }
}
