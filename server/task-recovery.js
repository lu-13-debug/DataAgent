import { createHash } from 'node:crypto';
import { createTask, makeEvent } from './workflow.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const OPTIONAL_STEPS = Object.freeze(['retention', 'monetization', 'insights']);
export function skipStepsValue(value = []) {
  if (!Array.isArray(value) || value.length > OPTIONAL_STEPS.length || value.some(id => !OPTIONAL_STEPS.includes(id))) fail('仅允许跳过 retention、monetization、insights 可选步骤');
  return [...new Set(value)].sort();
}
export function requestIdentity(value, payload) {
  if (value === undefined) return {};
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail('clientRequestId 必须为 1–100 位字母、数字、下划线或连字符');
  return { clientRequestId: value, _requestFingerprint: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}
export function repeatedTask(store, identity) {
  if (!identity.clientRequestId) return null;
  const previous = store.taskByRequestId(identity.clientRequestId);
  if (previous && previous._requestFingerprint !== identity._requestFingerprint) fail('此请求编号已用于不同输入，请使用新的 clientRequestId', 409);
  return previous;
}
export function recoveryInput(body, source) {
  if (!['restart', 'resume'].includes(body.strategy)) fail('恢复策略必须为 restart 或 resume');
  if (typeof body.useAI !== 'boolean') fail('useAI 必须为布尔值');
  const mode = body.mode === undefined ? source.mode : body.mode;
  if (!['collaborative', 'automatic'].includes(mode)) fail('请选择协作模式或自动模式');
  return { strategy: body.strategy, useAI: body.useAI, mode, skipSteps: skipStepsValue(body.skipSteps === undefined ? source.skippedSteps ?? [] : body.skipSteps) };
}
export function recoverTask(source, dataset, input, model) {
  if (!['failed', 'cancelled'].includes(source.status)) fail('仅失败或取消的任务可以创建恢复尝试', 409);
  const task = createTask({ title: source.title, goal: source.goal, domain: source.domain, mode: input.mode, useAI: input.useAI }, dataset, model);
  task.sourceTaskId = source.id; task.skippedSteps = input.skipSteps;
  const notice = task.messages[0];
  task.messages = structuredClone(source.messages || []);
  if (!task.messages.some(message => message.role === 'system' && message.content === notice.content)) task.messages.push(notice);
  if (input.strategy === 'resume') {
    const analyticalBranchesChanged = ['retention', 'monetization'].some(id => Boolean(source.skippedSteps?.includes(id)) !== task.skippedSteps.includes(id));
    // Reuse only a completed deterministic prefix. Reports/model calls always run again.
    for (const step of task.steps) {
      if (['report', 'verify'].includes(step.id)) break;
      if (step.id === 'insights' && analyticalBranchesChanged) break;
      const previous = source.steps.find(item => item.id === step.id);
      if (previous?.status !== 'completed') break;
      if (!task.skippedSteps.includes(step.id)) { step.status = 'completed'; step.summary = previous.summary; }
      if (step.id === 'plan') task._approved.push('plan');
    }
  }
  for (const step of task.steps) if (task.skippedSteps.includes(step.id)) { step.status = 'skipped'; step.summary = '由用户选择跳过；相关结果不会纳入报告或模型输入。'; }
  task.currentStep = task.steps.findIndex(step => step.status !== 'completed');
  task.progress = Math.round(task.steps.filter(step => step.status === 'completed').length * 100 / task.steps.length);
  task.events.push(makeEvent('info', '已创建恢复尝试', `来源任务 ${source.id}；${input.strategy === 'resume' ? '沿用已完成的确定性前缀，必要时重算核验' : '从数据质量检查重新开始'}，重新冻结 20 额度；原任务保持不变。`));
  return task;
}
