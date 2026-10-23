import { randomUUID } from 'node:crypto';
import { analyze } from './analytics.js';
import { enhanceReport } from './gateway.js';

const DEFINITIONS = [
  ['quality', '数据质量检查', '检查表结构、日期、订单与金额口径', 'data-quality'],
  ['plan', '制定分析计划', '根据分析目标和追加背景确认指标范围', 'analysis-plan'],
  ['activity', '活跃与新增分析', '按完整自然日统计活跃与注册用户', 'game-activity'],
  ['retention', '用户留存分析', '计算成熟注册 cohort 的 D1 / D7 回访留存', 'game-retention'],
  ['monetization', '商业化分析', '核对成功订单、收入与活跃付费率', 'game-monetization'],
  ['insights', '洞察与建议', '从聚合指标提取证据与观察结论', 'game-insights'],
  ['report', '生成分析报告', '整合指标、目标、协作背景和方法说明', 'report-writer'],
  ['verify', '结果核验', '复核数据覆盖范围、空值与指标边界', 'result-verifier'],
];
export const SKILLS = DEFINITIONS.map(([id, name, description, skillId]) => ({ id: skillId, name, description, category: id === 'quality' || id === 'verify' ? '质量保障' : '游戏运营', version: '1.0.0', enabled: true }));
export const DOMAINS = [
  { id: 'game', name: '游戏运营', description: '活跃、留存、渠道和商业化分析', enabled: true },
  { id: 'commerce', name: '电商经营', description: '订单、复购与经营分析，尚未开放', enabled: false },
  { id: 'saas', name: 'SaaS 增长', description: '激活、留存与订阅分析，尚未开放', enabled: false },
];
export const PROJECT = { id: 'project-game', name: '星河远征', domain: 'game', description: '游戏运营数据分析工作台 · 本地单用户项目' };
export const makeEvent = (type, title, detail, stepId) => ({ id: randomUUID(), type, title, detail, ...(stepId ? { stepId } : {}), createdAt: new Date().toISOString() });
export const makeMessage = (role, content) => ({ id: randomUUID(), role, content, createdAt: new Date().toISOString() });
export function createTask(input, dataset, model = '') {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), title: input.title, goal: input.goal, mode: input.mode, domain: 'game', datasetId: dataset.id, datasetName: dataset.name,
    status: 'running', currentStep: 0, progress: 0, createdAt: now, updatedAt: now, useAI: input.useAI, model: input.useAI ? model : '本地确定性分析', cost: 20,
    steps: DEFINITIONS.map(([id, name, description, skillId]) => ({ id, name, description, skillId, status: 'pending' })),
    events: [makeEvent('info', '任务已创建', '已冻结 20 试用额度；完成后结算，失败或取消释放。')],
    messages: [makeMessage('system', input.useAI ? '计算在本地完成，仅向配置的模型服务发送聚合指标和业务背景。' : '本任务使用本地确定性分析，不会发起模型调用。')],
    _approved: [],
  };
}
export function publicTask(task) { const { _approved, ...safe } = task; return safe; }

function validateReport(report) {
  if (!report || !report.daily.length) throw new Error('报告核验失败：没有完整自然日数据');
  for (const metric of report.metrics) {
    if (metric.value !== null && !Number.isFinite(metric.value)) throw new Error('报告核验失败：出现非有限数值');
    if (metric.unit === '%' && metric.value !== null && (metric.value < 0 || metric.value > 100)) throw new Error('报告核验失败：比例超出 0–100%');
  }
}

export class Workflow {
  constructor(store) {
    this.store = store; this.running = new Set(); this.controllers = new Map(); this.closed = false;
    // Credentials and the selected endpoint are captured per task only in memory.
    this.modelSnapshots = new Map(); this.lockedModelContexts = new Set();
    for (const task of store.list('task')) if (['running', 'awaiting_approval'].includes(task.status)) {
      task.status = 'failed'; task.error = '服务已重启，先前任务中断，冻结额度已释放。'; task.updatedAt = new Date().toISOString();
      const step = task.steps[task.currentStep]; if (step && step.status !== 'completed') step.status = 'failed';
      task.events.push(makeEvent('error', '任务因服务重启中断', task.error, step?.id)); store.finish(task, false);
    }
  }
  captureModel(id, options) { this.modelSnapshots.set(id, { ...options, settings: Object.freeze({ ...options.settings }) }); }
  isModelContextLocked(id) { return this.lockedModelContexts.has(id); }
  clearModel(id) { this.modelSnapshots.delete(id); this.lockedModelContexts.delete(id); }
  schedule(id) { setImmediate(() => { if (!this.closed) void this.run(id); }); }
  async run(id) {
    if (this.running.has(id) || this.closed) return;
    this.running.add(id);
    const controller = new AbortController(); this.controllers.set(id, controller);
    let analysis;
    try {
      let task = this.store.get('task', id);
      if (task?.status !== 'running') return;
      const dataset = this.store.get('dataset', task.datasetId);
      if (!dataset) throw new Error('任务数据集已不存在');
      for (let index = task.currentStep; index < task.steps.length; index++) {
        await new Promise(resolve => setImmediate(resolve));
        if (this.closed) return;
        task = this.store.get('task', id);
        if (task.status !== 'running') return;
        const step = task.steps[index];
        if (step.status === 'completed') continue;
        task.currentStep = index;
        const required = { activity: [['activity', '活跃']], retention: [['users', '注册'], ['activity', '活跃']], monetization: [['payments', '支付']] }[step.id];
        const missing = required?.filter(([type]) => !dataset.records?.[type]?.length).map(([, label]) => `${label}表`) || [];
        if (missing.length) {
          step.status = 'skipped'; step.summary = `缺少${missing.join('、')}，已跳过此分析；其他可用数据分支继续，相关指标显示无数据。`;
          task.progress = Math.round((index + 1) * 100 / task.steps.length); task.updatedAt = new Date().toISOString();
          task.events.push(makeEvent('info', `${step.name}已跳过`, step.summary, step.id)); this.store.put('task', task); continue;
        }
        if (task.mode === 'collaborative' && ['plan', 'report'].includes(step.id) && !task._approved.includes(step.id)) {
          step.status = 'awaiting_approval'; task.status = 'awaiting_approval'; task.updatedAt = new Date().toISOString();
          const detail = step.id === 'plan' ? `拟围绕“${task.goal}”分析数据质量、活跃、成熟留存和成功支付。请补充业务背景并确认计划。` : '已完成指标分析。请确认生成报告；你此前追加的业务背景将纳入报告。';
          task.events.push(makeEvent('approval', step.id === 'plan' ? '等待确认分析计划' : '等待确认生成报告', detail, step.id));
          task.messages.push(makeMessage('assistant', detail)); this.store.put('task', task); return;
        }
        step.status = 'running'; task.updatedAt = new Date().toISOString();
        task.events.push(makeEvent('start', step.name, step.description, step.id)); this.store.put('task', task);
        // Yield at real node transitions; no simulated progress or fabricated model thoughts.
        await new Promise(resolve => setImmediate(resolve));
        if (this.closed || this.store.get('task', id).status !== 'running') return;
        if (!analysis || ['quality', 'activity', 'retention', 'monetization', 'insights', 'report'].includes(step.id)) {
          analysis = analyze(dataset, { title: task.title, goal: task.goal, messages: this.store.get('task', id).messages });
        }
        let summary;
        switch (step.id) {
          case 'quality': summary = `检查 ${analysis.quality.rows} 行记录，发现 ${analysis.quality.issues.length} 项质量提示。`; break;
          case 'plan': summary = `目标：${task.goal}；仅分析实际可用的数据表，缺表指标显示无数据。`; break;
          case 'activity': summary = `已计算 ${analysis.daily.filter(day => day.dau !== null).length} 个完整覆盖自然日的活跃；${dataset.records.users?.length ? '新增以注册表为准。' : '缺少注册表，新增无数据。'}`; break;
          case 'retention': summary = `已计算 ${analysis.retention.length} 个注册 cohort；未成熟窗口保留无数据。`; break;
          case 'monetization': summary = `已核对成功订单去重与整数分金额；${dataset.records.activity?.length ? '已按最后完整活跃覆盖日核对付费交集与 ARPDAU，覆盖不足时显示无数据。' : '缺少活跃表，活跃付费率与 ARPDAU 无数据。'}`; break;
          case 'insights': summary = `已生成 ${analysis.findings.length} 条带证据的本地观察。`; break;
          case 'report': {
            task = this.store.get('task', id);
            if (task.useAI) {
              const model = this.modelSnapshots.get(id);
              if (!model?.key) throw new Error('本次任务的模型配置快照不可用，任务已停止，额度将释放。');
              this.lockedModelContexts.add(id);
              analysis = await enhanceReport(analysis, task, { ...model, signal: controller.signal });
            }
            summary = task.useAI ? '模型已基于聚合指标与业务背景生成报告；原始用户数据未发送。' : '已整合本地分析、业务目标、追加背景与方法说明。';
            break;
          }
          case 'verify':
            if (!task.useAI) analysis = analyze(dataset, { title: task.title, goal: task.goal, messages: this.store.get('task', id).messages });
            validateReport(analysis); summary = '报告数值、比例范围、完整日与空值口径核验通过。'; break;
        }
        if (this.closed) return;
        task = this.store.get('task', id);
        if (task.status !== 'running') return;
        task.steps[index].status = 'completed'; task.steps[index].summary = summary;
        task.progress = Math.round((index + 1) * 100 / task.steps.length); task.updatedAt = new Date().toISOString();
        task.events.push(makeEvent('complete', `${step.name}完成`, summary, step.id));
        if (step.id === 'report' || (step.id === 'verify' && !task.useAI)) task.report = analysis;
        if (index === task.steps.length - 1) {
          // A resumed runner rebuilds analysis, so retain the stored AI report for final validation.
          if (task.report) validateReport(task.report);
          task.status = 'completed'; task.messages.push(makeMessage('assistant', '分析报告已完成，20 试用额度已结算。'));
          this.store.finish(task, true);
        } else this.store.put('task', task);
      }
    } catch (error) {
      if (this.closed) return;
      const task = this.store.get('task', id);
      if (!task || ['cancelled', 'completed', 'failed'].includes(task.status)) return;
      task.status = 'failed'; task.error = error.message || '分析失败，额度已释放'; task.updatedAt = new Date().toISOString();
      task.steps[task.currentStep].status = 'failed'; task.events.push(makeEvent('error', '分析失败', task.error, task.steps[task.currentStep].id));
      this.store.finish(task, false);
    } finally {
      this.running.delete(id); this.controllers.delete(id);
      if (this.closed || ['completed', 'failed', 'cancelled'].includes(this.store.get('task', id)?.status)) this.clearModel(id);
    }
  }
  approve(task, message, expectedStepId) {
    if (task.status !== 'awaiting_approval') return task;
    const step = task.steps[task.currentStep];
    if (expectedStepId !== undefined && expectedStepId !== step.id) return task;
    if (!['plan', 'report'].includes(step.id)) throw new Error('当前节点不接受批准');
    if (message) task.messages.push(makeMessage('user', message));
    task._approved.push(step.id); step.status = 'pending'; task.status = 'running'; task.updatedAt = new Date().toISOString();
    task.events.push(makeEvent('approval', '已确认，继续分析', message || `已批准${step.name}`, step.id)); this.store.put('task', task); this.schedule(task.id); return task;
  }
  cancel(task) {
    if (!['running', 'awaiting_approval'].includes(task.status)) return task;
    task.status = 'cancelled'; task.updatedAt = new Date().toISOString();
    for (const step of task.steps) if (step.status !== 'completed') step.status = 'skipped';
    task.events.push(makeEvent('info', '任务已取消', '未完成任务的冻结额度已释放。'));
    this.controllers.get(task.id)?.abort(); this.clearModel(task.id); this.store.finish(task, false); return task;
  }
  close() { this.closed = true; for (const controller of this.controllers.values()) controller.abort(); this.modelSnapshots.clear(); this.lockedModelContexts.clear(); }
}

export function demoTask(dataset) {
  const task = createTask({ title: '近 28 天运营复盘', goal: '了解活跃、留存与收入趋势，识别值得进一步验证的渠道机会', mode: 'automatic', useAI: false }, dataset);
  task.status = 'completed'; task.currentStep = 7; task.progress = 100;
  task.steps.forEach(step => { step.status = 'completed'; step.summary = '基于示例数据真实计算并核验。'; });
  task.events = [makeEvent('info', '示例报告已生成', '使用确定性生成的演示数据完成本地真实计算；本条示例历史不扣费。')];
  task.messages = [makeMessage('assistant', '这是基于示例数据计算的演示报告，不代表真实业务。本条历史不消耗试用额度。')];
  task.report = analyze(dataset, { title: task.title, goal: task.goal }); return task;
}
