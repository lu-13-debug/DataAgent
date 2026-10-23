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
      CREATE UNIQUE INDEX IF NOT EXISTS unique_task_transaction ON transactions(task_id,type) WHERE task_id IS NOT NULL;`);
    if (!this.db.prepare('SELECT 1 FROM wallet').get()) this.atomic(() => {
      this.db.prepare('INSERT INTO wallet VALUES(1,500,0,0)').run();
      this.transaction('grant', 500, undefined, '本地试用额度赠送');
    });
  }
  atomic(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(kind, id) { assertId(id); const row = this.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(row.body) : null; }
  list(kind) { return this.db.prepare('SELECT body FROM entities WHERE kind=? ORDER BY rowid DESC').all(kind).map(x => JSON.parse(x.body)); }
  put(kind, value) { assertId(value.id); this.db.prepare('INSERT INTO entities(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, value.id, JSON.stringify(value)); return value; }
  delete(kind, id) { assertId(id); this.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, id); }
  config(key, value) {
    if (value === undefined) { const row = this.db.prepare('SELECT body FROM config WHERE key=?').get(key); return row ? JSON.parse(row.body) : null; }
    this.db.prepare('INSERT INTO config VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key, JSON.stringify(value));
    return value;
  }
  wallet() { const row = this.db.prepare('SELECT balance,frozen,spent FROM wallet WHERE id=1').get(); return { ...row }; }
  transactions() { return this.db.prepare('SELECT * FROM transactions ORDER BY rowid DESC').all().map(x => ({ id: x.id, type: x.type, amount: x.amount, ...(x.task_id ? { taskId: x.task_id } : {}), description: x.description, createdAt: x.created_at })); }
  transaction(type, amount, taskId, description) { this.db.prepare('INSERT INTO transactions VALUES(?,?,?,?,?,?)').run(randomUUID(), type, amount, taskId || null, description, new Date().toISOString()); }
  createTask(task) {
    return this.atomic(() => {
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
  close() { this.db.close(); }
}
