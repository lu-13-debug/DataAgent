import { isModelErrorCode } from './task-errors.js';
export const TASK_CAPABILITIES = Object.freeze({ taskEvents: true, taskRecovery: true, taskSkip: true, taskSummaries: true, idempotentTasks: true, walletVersion: true, reportExplore: true, reportMetadata: true, reportContinuation: true });
const fields = ['id', 'title', 'mode', 'domain', 'datasetId', 'datasetName', 'status', 'currentStep', 'progress', 'createdAt', 'updatedAt', 'useAI', 'model', 'cost', 'sourceTaskId', 'sourceKind'];
export function taskSummary(task) {
  const summary = Object.fromEntries(fields.filter(field => task[field] !== undefined).map(field => [field, task[field]]));
  summary.steps = (task.steps || []).slice(0, 8).map(({ id, name, status }) => ({ id, name, status }));
  summary.skippedSteps = (task.skippedSteps || []).filter(id => ['retention', 'monetization', 'insights'].includes(id));
  if (isModelErrorCode(task.errorCode)) summary.errorCode = task.errorCode;
  return summary;
}

export class TaskMonitor {
  constructor(store, { maxTaskEventConnections = 4, taskHeartbeatMs = 3000, isSessionValid, onTaskEventConnect, getTaskEventOrigin } = {}) {
    this.store = store; this.clients = new Set(); this.closed = false;
    this.maxConnections = Math.max(1, Math.min(8, maxTaskEventConnections));
    this.isSessionValid = isSessionValid; this.onConnect = onTaskEventConnect;
    this.getOrigin = getTaskEventOrigin || ((req) => `${req.protocol}://${req.get('host')}`);
    this.unsubscribe = store.subscribe(() => {
      if (!this.clients.size) return;
      const snapshot = this.snapshot();
      for (const client of this.clients) this.send(client, 'snapshot', snapshot);
    });
    this.timer = setInterval(() => { for (const client of this.clients) this.send(client, 'heartbeat', { timestamp: new Date().toISOString() }); }, taskHeartbeatMs);
    this.timer.unref();
  }
  get size() { return this.clients.size; }
  snapshot() { return { summaries: this.store.monitorTasks(100).map(taskSummary), ...this.store.walletSnapshot() }; }
  valid(req) { try { return !this.isSessionValid || this.isSessionValid(req); } catch { return false; } }
  send(client, event, value) {
    if (!this.valid(client.req)) { client.close(); return; }
    // Slow/background clients reconnect to a fresh snapshot; never build an unbounded write queue.
    if (client.res.destroyed || client.res.writableEnded || client.res.writableLength > 128 * 1024) { client.close(); return; }
    if (client.blocked) { if (event === 'snapshot') client.dirty = true; return; }
    try {
      if (!client.res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)) {
        client.blocked = true;
        client.onDrain = () => {
          client.blocked = false;
          if (client.dirty) { client.dirty = false; this.send(client, 'snapshot', this.snapshot()); }
        };
        client.res.once('drain', client.onDrain);
      }
    } catch { client.close(); }
  }
  connect(req, res) {
    // Guard the matched route itself: Express also accepts trailing slashes and casing variants.
    if ((req.get('origin') && req.get('origin') !== this.getOrigin(req, res)) || ['same-site', 'cross-site'].includes(req.get('sec-fetch-site'))) return res.status(403).json({ error: '任务事件仅接受同源连接' });
    if (this.closed || !this.valid(req)) return res.status(401).json({ error: '登录已失效，请重新登录' });
    if (this.clients.size >= this.maxConnections) return res.status(429).json({ error: '任务事件连接过多，请关闭多余页面后重试' });
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const client = { req, res, close: () => { this.clients.delete(client); res.off('close', client.close); if (client.onDrain) res.off('drain', client.onDrain); if (!res.writableEnded) res.end(); } };
    this.clients.add(client); res.once('close', client.close);
    this.onConnect?.(req, res);
    res.flushHeaders(); this.send(client, 'snapshot', this.snapshot());
  }
  close() { if (this.closed) return; this.closed = true; clearInterval(this.timer); this.unsubscribe(); for (const client of this.clients) client.close(); }
}
