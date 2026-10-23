import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from './store.js';
import { Workflow, createTask } from './workflow.js';
import { createDataset } from './datasets.js';

const response = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '聚合结果', findings: [], recommendations: [] }) } }] }), { status: 200 });

for (const outcome of ['completed', 'failed', 'cancelled']) {
  test(`task-scoped model credential snapshot is removed after ${outcome}`, async t => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dataagent-workflow-'));
    const store = new Store(dir);
    const workflow = new Workflow(store);
    t.after(async () => { workflow.close(); store.close(); await rm(dir, { recursive: true, force: true }); });
    const dataset = createDataset({ users: [{ user_id: 'u1', registered_at: '2026-10-01', channel: '自然' }] });
    store.put('dataset', dataset);
    const task = createTask({ title: '快照清理', goal: '核验快照生命周期', mode: outcome === 'cancelled' ? 'collaborative' : 'automatic', useAI: true }, dataset, 'frozen-model');
    store.createTask(task);
    workflow.captureModel(task.id, { settings: { provider: 'frozen-provider', baseUrl: 'https://old.example.test/v1', model: 'frozen-model' }, key: 'only-in-memory', fetchImpl: async () => outcome === 'failed' ? new Response('{}', { status: 401 }) : response() });
    workflow.schedule(task.id);
    for (let i = 0; i < 100; i++) {
      const current = store.get('task', task.id);
      if (outcome === 'cancelled' && current.status === 'awaiting_approval') workflow.cancel(current);
      if (store.get('task', task.id).status === outcome) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(store.get('task', task.id).status, outcome);
    assert.equal(workflow.modelSnapshots.has(task.id), false);
    assert.equal(workflow.isModelContextLocked(task.id), false);
    assert.equal(store.wallet().frozen, 0);
  });
}
