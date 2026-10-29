import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const state = await import('./product-state.ts').catch(() => ({}));
const onboarding = await import('./onboarding.ts').catch(() => ({}));
const diagnostics = await import('./diagnostics.ts').catch(() => ({}));

test('AI eligibility and service credits stay independent for both runtimes', () => {
  assert.equal(typeof state.analysisAccess, 'function');
  const settings = { hasKey: true };
  const wallet = { balance: 500 };
  const blocked = state.analysisAccess({ mode: 'cloud', modelHosts: [] }, settings, wallet);
  assert.equal(blocked.aiAllowed, false); assert.equal(blocked.canStart, true);
  assert.match(blocked.modelLabel, /暂未开放/); assert.match(blocked.modelDescription, /确定性/);
  const noKey = state.analysisAccess({ mode: 'cloud', modelHosts: ['api.deepseek.com'] }, { hasKey: false }, wallet);
  assert.equal(noKey.canUseAI, false); assert.match(noKey.modelLabel, /未配置/);
  const insufficient = state.analysisAccess({ mode: 'local' }, settings, { balance: 19 });
  assert.equal(insufficient.canUseAI, true); assert.equal(insufficient.canStart, false); assert.match(insufficient.quotaLabel, /20/);
  assert.equal(state.analysisAccess({ mode: 'local' }, settings, { balance: 20 }).canStart, true);
});

test('missing and paused tasks never claim that an analysis is running', () => {
  assert.equal(typeof state.workspaceMessage, 'function');
  assert.equal(state.workspaceMessage(undefined).kind, 'empty');
  assert.doesNotMatch(state.workspaceMessage(undefined).title, /正在/);
  const paused = state.workspaceMessage({ status: 'awaiting_approval', steps: [{ id: 'plan', status: 'awaiting_approval' }] });
  assert.equal(paused.kind, 'waiting'); assert.match(paused.title, /确认/);
  assert.equal(state.workspaceMessage({ status: 'running', steps: [] }).kind, 'running');
  assert.equal(state.workspaceMessage({ status: 'failed', error: '已释放额度', steps: [] }).kind, 'failed');
});

function storage() { const entries = new Map(); return { getItem: k => entries.get(k) ?? null, setItem: (k, v) => entries.set(k, v), entries }; }

test('onboarding progress and dismissal persist without crossing accounts, origins or runtimes', () => {
  assert.equal(typeof onboarding.onboardingKey, 'function');
  const a = onboarding.onboardingKey({ mode: 'cloud' }, { id: 'user-a' }, 'https://a.example');
  const b = onboarding.onboardingKey({ mode: 'cloud' }, { id: 'user-b' }, 'https://a.example');
  const c = onboarding.onboardingKey({ mode: 'cloud' }, { id: 'user-a' }, 'https://b.example');
  const local = onboarding.onboardingKey({ mode: 'local' }, null, 'https://a.example');
  assert.equal(new Set([a, b, c, local]).size, 4);
  const memory = storage();
  onboarding.writeOnboarding(memory, a, { viewedSample: true, selectedData: true, generatedReport: false, dismissed: true, apiKey: 'must-not-persist' });
  assert.deepEqual(onboarding.readOnboarding(memory, a), { viewedSample: true, selectedData: true, generatedReport: false, dismissed: true });
  assert.equal(onboarding.readOnboarding(memory, b).dismissed, false);
  assert.equal(JSON.stringify([...memory.entries.values()]).includes('must-not-persist'), false);
});

test('onboarding tolerates blocked or corrupt browser storage', () => {
  assert.equal(typeof onboarding.readOnboarding, 'function');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(onboarding.readOnboarding(blocked, 'key').viewedSample, false);
  assert.doesNotThrow(() => onboarding.writeOnboarding(blocked, 'key', {}));
  assert.equal(onboarding.readOnboarding({ getItem: () => '{broken' }, 'key').dismissed, false);
  assert.equal(onboarding.readOnboarding({ getItem: () => '{"dismissed":"false","viewedSample":{}}' }, 'key').dismissed, false);
});

test('a precomputed free report does not count as generating a first report', () => {
  assert.equal(typeof onboarding.progressFromData, 'function');
  const sample = { status: 'completed', datasetId: 'demo', report: { summary: '示例报告' }, events: [{ type: 'info', title: '示例报告已生成' }] };
  const initial = onboarding.readOnboarding(storage(), 'initial');
  assert.equal(onboarding.progressFromData(initial, [{ source: 'demo' }], [sample]).generatedReport, false);
  const paidSampleRun = { ...sample, events: [] };
  assert.equal(onboarding.progressFromData(initial, [{ source: 'demo' }], [paidSampleRun]).generatedReport, true);
  assert.equal(onboarding.progressFromData(initial, [], [{ ...paidSampleRun, report: undefined }]).generatedReport, false);
  assert.equal(onboarding.progressFromData(initial, [{ source: 'upload' }], [sample]).selectedData, true);
  assert.equal(onboarding.onboardingComplete({ viewedSample: true, selectedData: true, generatedReport: true }), true);
});

test('diagnostics contain only allowlisted metadata even when an exception contains credentials', () => {
  assert.equal(typeof diagnostics.buildDiagnostic, 'function');
  const error = new TypeError('apiKey=sk-private-123; bearer personal-session');
  error.stack = 'TypeError: sk-private-123 at https://service.test/?token=personal-session';
  const output = diagnostics.buildDiagnostic(error, '1.1.0', new Date('2026-10-25T10:00:00Z'));
  const data = JSON.parse(output);
  assert.deepEqual(Object.keys(data).sort(), ['code', 'errorType', 'timestamp', 'version']);
  assert.equal(data.errorType, 'TypeError'); assert.equal(data.version, '1.1.0');
  assert.doesNotMatch(output, /sk-private|personal-session|https:\/\//);
  assert.equal(JSON.parse(diagnostics.buildDiagnostic({ name: 'sk-private-123' }, 'secret-version')).errorType, 'Error');
});

test('帮助入口提供固定反馈链接并说明诊断不会自动发送', () => {
  const source = readFileSync(new URL('./components/HelpModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /https:\/\/github\.com\/lu-13-debug\/DataAgent\/issues/);
  assert.match(source, /不会自动发送/);
  assert.match(source, /复制诊断信息/);
});
