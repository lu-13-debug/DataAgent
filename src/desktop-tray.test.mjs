import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('./desktop-tray.ts', import.meta.url), 'utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS }), context);
const { taskSummaries } = context.exports;
test('托盘仅发送运行和待确认任务的最小摘要并限制数量', () => {
  const tasks = Array.from({ length: 25 }, (_, i) => ({ id: `${i}`, title: '分析', status: 'running', apiKey: 'secret' }));
  tasks.unshift({ id: 'done', title: '完成', status: 'completed' });
  const result = taskSummaries(tasks);
  assert.equal(result.length, 20);
  assert.equal(JSON.stringify(result[0]), JSON.stringify({ id: '0', title: '分析', status: 'running' }));
});

test('旧版和损坏桥的同步、异步错误及非 Promise 返回不会阻断界面', async () => {
  const { setDesktopState, setDesktopSummaries, subscribeDesktopNew, showDesktopWindow } = context.exports;
  const cases = [undefined, {}, { setTrayState() { throw Error('sync'); }, setTaskSummaries() { throw Error('sync'); }, onNewAnalysis() { throw Error('sync'); }, showWindow() { throw Error('sync'); } }, { setTrayState: () => Promise.reject(Error('async')), setTaskSummaries: () => Promise.reject(Error('async')), onNewAnalysis: () => 123, showWindow: () => Promise.reject(Error('async')) }, { setTrayState: () => 123, setTaskSummaries: () => undefined, onNewAnalysis: () => () => { throw Error('cleanup'); }, showWindow: () => null }, { onNewAnalysis: () => Promise.reject(Error('subscribe')) }, { onNewAnalysis: () => () => Promise.reject(Error('cleanup')) }];
  for (const bridge of cases) {
    assert.doesNotThrow(() => { setDesktopState(bridge, 'login'); setDesktopSummaries(bridge, []); const cleanup = subscribeDesktopNew(bridge, () => {}); cleanup(); showDesktopWindow(bridge); });
  }
  await new Promise(resolve => setImmediate(resolve));
});

test('旧版或损坏桥在注销时仍清除当前账号', async () => {
  const authSource = readFileSync(new URL('./AuthRoot.tsx', import.meta.url), 'utf8');
  for (const bridge of [{}, { setTrayState() { throw Error('sync'); } }, { setTrayState: () => Promise.reject(Error('async')) }, { setTrayState: () => 42 }]) {
    const states = [{ mode: 'cloud' }, { id: 'user' }, false]; let index = 0;
    const react = { useState(initial) { const n = index++; if (!(n in states)) states[n] = initial; return [states[n], value => { states[n] = typeof value === 'function' ? value(states[n]) : value; }]; }, useCallback: fn => fn, useEffect() {}, useRef: value => ({ current: value }) };
    const authContext = { Provider: 'provider' };
    const auth = { exports: {}, window: { dataagentDesktop: bridge }, require(name) { if (name === 'react') return react; if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }; if (name === './auth-context') return { AuthContext: authContext }; if (name === './api') return { resetSessionBoundary() {} }; if (name === './desktop-tray') return context.exports; return {}; } };
    vm.runInNewContext(ts.transpileModule(authSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, auth);
    const provider = auth.exports.AuthRoot({ children: null });
    assert.doesNotThrow(() => provider.props.value.endSession('已退出')); assert.equal(states[1], null);
  }
  await new Promise(resolve => setImmediate(resolve));
});
