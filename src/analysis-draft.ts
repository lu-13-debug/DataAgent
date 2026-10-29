import type { Dataset, Mode } from './types';
export interface AnalysisChoices { mode?: Mode; datasetId?: string; useAI?: boolean }
export function choiceKey(mode: string, userId: string | undefined, origin: string) { return `dataagent:analysis-choices:v1:${mode}:${encodeURIComponent(origin)}:${mode === 'cloud' ? encodeURIComponent(userId || 'anonymous') : 'local'}`; }
export function readChoices(storage: Pick<Storage, 'getItem'>, key: string): AnalysisChoices {
  try {
    const value = JSON.parse(storage.getItem(key) || '{}');
    return { ...(['automatic', 'collaborative'].includes(value?.mode) ? { mode: value.mode } : {}), ...(typeof value?.datasetId === 'string' ? { datasetId: value.datasetId.slice(0, 128) } : {}), ...(typeof value?.useAI === 'boolean' ? { useAI: value.useAI } : {}) };
  } catch { return {}; }
}
export function saveChoices(storage: Pick<Storage, 'setItem'>, key: string, value: AnalysisChoices) {
  try { storage.setItem(key, JSON.stringify({ mode: value.mode, datasetId: value.datasetId, useAI: value.useAI })); } catch { /* 无法存储时使用本次会话选择。 */ }
}
export function resolveChoices(stored: AnalysisChoices, datasets: Pick<Dataset, 'id'>[], canUseAI: boolean, explicit: AnalysisChoices = {}) {
  const preferred = { ...stored, ...explicit }; const corrections: string[] = [];
  let datasetId = preferred.datasetId || datasets[0]?.id || '';
  if (datasetId && !datasets.some(dataset => dataset.id === datasetId)) { datasetId = datasets[0]?.id || ''; corrections.push('上次数据源已不存在，请核对当前数据选择。'); }
  if (preferred.useAI && !canUseAI) corrections.push('当前 AI 不可用，已切换为仅确定性分析。');
  return { datasetId, mode: preferred.mode || 'collaborative' as Mode, useAI: Boolean(preferred.useAI && canUseAI), corrections };
}
export function suggestTitle(goal: string, period?: { start: string; end: string }) {
  const subject = /版本/.test(goal) ? '版本表现对比' : /活动/.test(goal) ? '运营活动复盘' : /渠道/.test(goal) ? '渠道质量分析' : /付费|支付|收入|转化/.test(goal) ? '付费表现分析' : /留存/.test(goal) ? '玩家留存诊断' : goal.trim().replace(/[\r\n。！？]/g, ' ').slice(0, 28) || '游戏运营分析';
  return `${subject}${period?.end ? ` · ${period.end.slice(0, 10)}` : ''}`.slice(0, 80);
}
export function goalAdvice(goal: string) {
  const suggestions: string[] = [];
  if (!/\d{4}[-年/]|近\s*\d+\s*[天日周月]|最近|本周|上周|本月|上月|期间|当前数据|全部覆盖/.test(goal)) suggestions.push('补充时间范围，例如“最近 7 天”或明确起止日期。');
  if (!/活跃|新增|留存|付费|支付|收入|转化|DAU|ARPPU|ARPDAU|用户|玩家|渠道/i.test(goal)) suggestions.push('指出关注指标，例如 DAU、D1 留存或成功支付收入。');
  if (!/对比|相比|较|环比|同比|vs|版本前后|活动前后/i.test(goal)) suggestions.push('如需判断变化，可补充对比对象，例如前一周期或两个渠道。');
  return suggestions;
}
