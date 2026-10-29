import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as taskMonitor from './task-monitor.ts';

const requireReal = createRequire(import.meta.url);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const transpile = (file, jsx) => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) } }).outputText;
await test('StrictMode initial bootstrap late response preserves newer wallet and task', async () => {
  let cursor = 0; const state = []; const effects = []; const pending = []; let monitorOptions;
  const react = {
    useCallback: fn => fn, useEffect: fn => effects.push(fn),
    useRef(value) { const id = cursor++; if (!(id in state)) state[id] = { current: value }; return state[id]; },
    useState(initial) { const id = cursor++; if (!(id in state)) state[id] = typeof initial === 'function' ? initial() : initial; return [state[id], next => { state[id] = typeof next === 'function' ? next(state[id]) : next; }]; },
  };
  const runtime = { mode: 'local', capabilities: { taskEvents: true, walletVersion: true } };
  const stubs = {
    './api': { api: { bootstrap: signal => new Promise(resolve => pending.push({ resolve, signal })) } },
    './auth-context': { useAuth: () => ({ runtime, user: null }) }, './task-monitor': taskMonitor,
    './appearance-context': { useAppearance: () => ({ theme: 'system', resolvedTheme: 'light', view: 'standard', setTheme() {}, setView() {} }) },
    './use-task-monitor': { useTaskMonitor: value => { monitorOptions = value; return { connection: 'connected', permission: 'default' }; } },
    './use-onboarding': { useOnboarding: () => ({ mark() {}, progress: {}, visible: false }) },
    './use-report-metadata': { useReportMetadata: () => ({}) },
    './onboarding': { isPresetSample: () => false }, './product-state': { analysisAccess: () => ({ canStart: true }) },
    './analysis-draft': { choiceKey: () => 'choice', readChoices: () => ({}) },
  };
  const context = { exports: {}, require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? requireReal(name) : stubs[name] || {}, window: { location: { origin: 'http://localhost' } }, localStorage: {}, AbortController, AbortSignal };
  vm.runInNewContext(transpile('src/App.tsx', true), context); context.exports.default();
  const cleanup = effects[0](); if (typeof cleanup === 'function') cleanup(); effects[0]();
  assert.equal(pending.length, 2, 'StrictMode effect replay should exercise two initial requests');
  const old = { id: 'historical', status: 'completed', createdAt: '2026-10-26T00:00:00Z', updatedAt: '2026-10-26T00:00:00Z', steps: [] };
  const initial = { tasks: [old], wallet: { balance: 500, frozen: 0, spent: 0 }, walletVersion: 1, datasets: [], project: {}, settings: {}, skills: [], domains: [] };
  // The live replay finishes first. The already-cleaned-up request completes late.
  pending[1].resolve(initial); await flush(); cursor = 0; context.exports.default();
  const next = { ...old, id: 'new-task', status: 'awaiting_approval', createdAt: '2026-10-26T01:00:00Z', updatedAt: '2026-10-26T01:00:00Z' };
  monitorOptions.onSnapshot({ summaries: [next], wallet: { balance: 480, frozen: 20, spent: 0 }, walletVersion: 2 });
  pending[0].resolve(initial); await flush();
  const current = state.find(value => value?.wallet && Array.isArray(value.tasks));
  const evidence = { walletVersion: current.walletVersion, balance: current.wallet.balance, taskIds: current.tasks.map(task => task.id) };
  assert.equal(current.walletVersion, 2, JSON.stringify(evidence));
  assert.equal(current.wallet.balance, 480, JSON.stringify(evidence));
  assert.ok(current.tasks.some(task => task.id === 'new-task'), JSON.stringify(evidence));
  return evidence;
});

function hookHarness({ bootstrapFails = false, bootstrapFailures = 0, hiddenDesktop = false, hiddenBrowser = false } = {}) {
  let now = 100000; let intervals = []; let timeouts = []; const effects = []; const states = []; const sources = [];
  let bootstrapCalls = 0; let summaryCalls = 0; let calibrated = 0; const bootstrapTimes = []; const listeners = {};
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const document = { hidden: hiddenDesktop || hiddenBrowser, title: 'DataAgent', addEventListener(name, fn) { listeners[name] = fn; }, removeEventListener(name) { delete listeners[name]; } };
  const window = { EventSource: true, ...(hiddenDesktop ? { dataagentDesktop: {} } : {}), addEventListener() {}, removeEventListener() {} };
  const old = { id: 'history', title: '历史', status: 'completed', updatedAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString(), progress: 100, steps: [{ id: 'quality', description: '已校准' }], report: {} };
  const options = { data: { tasks: [old] }, activeId: old.id, runtime: { capabilities: { taskEvents: true, taskSummaries: true } }, onBootstrap() { calibrated++; }, onSnapshot() {}, onDetails() {}, onTerminal() {}, onFocusTask() {} };
  const react = { useCallback: fn => fn, useRef: value => ({ current: value }), useState: value => [typeof value === 'function' ? value() : value, value => states.push(value)], useEffect: fn => effects.push(fn) };
  const api = { bootstrap: async () => { bootstrapCalls++; bootstrapTimes.push(now); if (bootstrapCalls <= (bootstrapFailures || (bootstrapFails ? 1 : 0))) throw Error('temporary failure'); return options.data; }, taskSummaries: async () => { summaryCalls++; return { summaries: [], wallet: {} }; } };
  const context = { exports: {}, require: name => name === 'react' ? react : name === './api' ? { api } : taskMonitor, window, document, Date: FakeDate, AbortController, AbortSignal,
    EventSource: function() { const source = { handlers: {}, closed: false, close() { this.closed = true; }, addEventListener(kind, fn) { this.handlers[kind] = fn; } }; sources.push(source); return source; },
    setInterval: (fn, ms) => { const timer = { fn, ms, next: now + ms }; intervals.push(timer); return timer; }, clearInterval: timer => { intervals = intervals.filter(item => item !== timer); },
    setTimeout: (fn, ms) => { const timer = { fn, at: now + ms }; timeouts.push(timer); return timer; }, clearTimeout: timer => { timeouts = timeouts.filter(item => item !== timer); },
  };
  vm.runInNewContext(transpile('src/use-task-monitor.ts'), context); context.exports.useTaskMonitor(options); const cleanup = effects[0](); sources[0].onopen();
  return {
    show() { document.hidden = false; listeners.visibilitychange?.(); },
    snapshot() { const done = { ...old, id: 'new-completed', status: 'completed', updatedAt: new Date(now + 1).toISOString() }; sources.at(-1).handlers.snapshot({ data: JSON.stringify({ summaries: [done], wallet: {} }) }); },
    async advance(ms, heartbeat = true) { const end = now + ms; while (now < end) { now = Math.min(now + 250, end); const ready = timeouts.filter(item => item.at <= now); timeouts = timeouts.filter(item => item.at > now); for (const item of ready) item.fn(); if (heartbeat && now % 3000 < 250) { const current = sources.at(-1); if (!current.closed) current.handlers.heartbeat(); } for (const timer of [...intervals]) if (timer.next <= now) { timer.next += timer.ms; timer.fn(); } await flush(); } },
    evidence: () => ({ bootstrapCalls, bootstrapTimes, calibrated, summaryCalls, sources: sources.length, closedSources: sources.filter(source => source.closed).length, pendingTimers: timeouts.length, latestConnection: states.at(-1) }),
    cleanup,
  };
}

await test('terminal calibration retries temporary failure while SSE only heartbeats', async () => {
  const hook = hookHarness({ bootstrapFails: true });
  try { hook.snapshot(); await hook.advance(20000); const evidence = hook.evidence(); assert.equal(evidence.calibrated, 1, JSON.stringify(evidence)); assert.equal(evidence.bootstrapCalls, 2, JSON.stringify(evidence)); return evidence; }
  finally { hook.cleanup(); }
});
await test('SSE stale heartbeat closes stream and restores bounded summary fallback', async () => {
  const hook = hookHarness();
  try { await hook.advance(20000, false); const evidence = hook.evidence(); assert.ok(evidence.closedSources >= 1, JSON.stringify(evidence)); assert.ok(evidence.summaryCalls >= 1, JSON.stringify(evidence)); return evidence; }
  finally { hook.cleanup(); }
});


await test('desktop hidden window retains bounded summary fallback when SSE stalls', async () => {
  const hook = hookHarness({ hiddenDesktop: true });
  try { await hook.advance(20000, false); assert.ok(hook.evidence().summaryCalls >= 1); } finally { hook.cleanup(); }
});

await test('hidden desktop retries failed terminal calibration with backoff on heartbeat alone, then stops', async () => {
  const hook = hookHarness({ bootstrapFails: true, hiddenDesktop: true });
  try {
    hook.snapshot(); await hook.advance(500);
    assert.equal(hook.evidence().bootstrapCalls, 1);
    await hook.advance(500); assert.equal(hook.evidence().bootstrapCalls, 1, 'retry is not immediate');
    await hook.advance(20000); assert.equal(hook.evidence().bootstrapCalls, 2); assert.equal(hook.evidence().calibrated, 1);
    await hook.advance(20000); assert.equal(hook.evidence().bootstrapCalls, 2, 'success must not create periodic bootstrap refresh');
  } finally { hook.cleanup(); }
});
await test('hidden browser pauses terminal calibration until visible', async () => {
  const hook = hookHarness({ hiddenBrowser: true });
  try { hook.snapshot(); await hook.advance(20000); assert.equal(hook.evidence().bootstrapCalls, 0); hook.show(); await hook.advance(250); assert.equal(hook.evidence().calibrated, 1); } finally { hook.cleanup(); }
});
await test('desktop calibration retry is cancelled at session cleanup', async () => {
  const hook = hookHarness({ bootstrapFails: true, hiddenDesktop: true });
  hook.snapshot(); await hook.advance(500); assert.equal(hook.evidence().bootstrapCalls, 1);
  hook.cleanup(); await hook.advance(20000); assert.equal(hook.evidence().bootstrapCalls, 1); assert.equal(hook.evidence().calibrated, 0);
});

await test('hidden desktop calibration retries use exponential delay capped at 15 seconds', async () => {
  const hook = hookHarness({ bootstrapFailures: 6, hiddenDesktop: true });
  try {
    hook.snapshot(); await hook.advance(60000);
    const times = hook.evidence().bootstrapTimes;
    assert.equal(times.length, 7);
    assert.deepEqual(times.slice(1).map((time, i) => time - times[i]), [1000, 2000, 4000, 8000, 15000, 15000]);
    assert.equal(hook.evidence().calibrated, 1);
  } finally { hook.cleanup(); }
});
