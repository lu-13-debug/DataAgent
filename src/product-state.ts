import type { Runtime, Settings, Task, Wallet } from './types';

export const ANALYSIS_COST = 20;
export function analysisAccess(runtime: Pick<Runtime, 'mode' | 'modelHosts'>, settings: Pick<Settings, 'hasKey'>, wallet: Pick<Wallet, 'balance'>) {
  const aiAllowed = runtime.mode === 'local' || Boolean(runtime.modelHosts?.length);
  const canUseAI = aiAllowed && settings.hasKey;
  const canStart = wallet.balance >= ANALYSIS_COST;
  return {
    aiAllowed, canUseAI, canStart,
    modelLabel: !aiAllowed ? 'AI 暂未开放' : settings.hasKey ? '模型已配置' : '未配置 API Key',
    modelDescription: !aiAllowed ? '管理员尚未开放 AI，确定性指标计算和规则解读仍可使用。'
      : settings.hasKey ? '新分析可选择 AI 辅助解读，模型费用由你的 API 账户支付。' : '可先使用确定性分析，配置 API Key 后再启用 AI 辅助解读。',
    quotaLabel: canStart ? `每次分析 ${ANALYSIS_COST} 额度` : `额度不足，开始分析需 ${ANALYSIS_COST} 额度`,
    trialLabel: runtime.mode === 'cloud' ? '账号试用额度' : '本地试用额度',
  };
}

export function workspaceMessage(task?: Pick<Task, 'status' | 'steps' | 'error'>) {
  if (!task) return { kind: 'empty', title: '从第一份分析开始', detail: '上传或选择一份数据，确认分析范围后生成报告。' };
  if (task.status === 'failed') return { kind: 'failed', title: '本次分析未完成', detail: task.error || '请检查执行记录，再创建一次分析。' };
  if (task.status === 'cancelled') return { kind: 'cancelled', title: '分析已取消', detail: '冻结的服务额度已释放，可随时开始新的分析。' };
  if (task.status === 'awaiting_approval') return { kind: 'waiting', title: task.steps.some(step => step.id === 'report' && step.status === 'awaiting_approval') ? '等待你确认生成报告' : '等待你确认分析计划', detail: '请在工作动态中检查范围、补充背景，并确认继续。' };
  if (task.status === 'running') return { kind: 'running', title: '正在把数据变成洞察', detail: '工作动态会展示当前步骤和实际产出。' };
  return { kind: 'unavailable', title: '报告暂不可用', detail: '可重新载入工作台，或新建一次分析。' };
}
