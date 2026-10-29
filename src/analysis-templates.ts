import type { Dataset } from './types';
export interface AnalysisTemplate { id: string; title: string; tables: string[]; question: string; output: string; context?: string }
export const analysisTemplates: AnalysisTemplate[] = [
  { id: 'retention', title: '留存诊断', tables: ['users', 'activity'], question: '对比不同注册 cohort 的成熟 D1 / D7 留存，找出需要关注的变化。', output: '成熟 cohort 留存表、样本量、指标依据和行动建议。' },
  { id: 'channel', title: '渠道质量', tables: ['users', 'activity'], question: '对比不同注册渠道的新增玩家与成熟次日留存，识别样本不足和观察差异。', output: '渠道新增与留存汇总，列出数据局限；不推断渠道因果。' },
  { id: 'payment', title: '付费转化', tables: ['users', 'activity', 'payments'], question: '对比活跃、成功支付收入、ARPPU 与活跃付费率，检查覆盖是否可比。', output: '收入、成功订单与付费转化口径、覆盖局限和建议。' },
  { id: 'version', title: '版本对比', tables: ['users', 'activity'], question: '对比版本更新前后的活跃、新增与成熟留存，检查观察周期与样本是否可比。', output: '前后期间的观察性复盘；缺少版本日期时说明无法直接归因。', context: '请补充两个版本名称、上线日期及比较期间；现有数据不含版本字段。' },
  { id: 'event', title: '活动复盘', tables: ['users', 'activity', 'payments'], question: '对比运营活动前后的活跃、留存与成功支付表现，列出数据支持的变化和局限。', output: '活动前后运营指标与证据，不把自然变化解释为活动效果。', context: '请补充活动起止日期、参与范围及对照期间；现有数据不含活动参与标记。' },
];
export function templateAvailability(template: AnalysisTemplate, datasets: Pick<Dataset, 'id' | 'tables' | 'inspection' | 'source'>[]) {
  const sorted = [...datasets].sort((a, b) => Number(a.source === 'demo') - Number(b.source === 'demo'));
  const dataset = sorted.find(item => item.inspection?.analyzable !== false && template.tables.every(type => item.tables.some(table => table.type === type)));
  const closest = sorted.filter(item => item.inspection?.analyzable !== false).sort((a, b) => template.tables.filter(type => a.tables.some(table => table.type === type)).length - template.tables.filter(type => b.tables.some(table => table.type === type)).length).at(-1);
  return { dataset, missing: dataset ? [] : template.tables.filter(type => !closest?.tables.some(table => table.type === type)) };
}
export function templateGoal(template: AnalysisTemplate, dataset: Partial<Pick<Dataset, 'dateRange'>>) {
  return `在${dataset.dateRange?.start ? ` ${dataset.dateRange.start.slice(0, 10)} 至 ${dataset.dateRange.end.slice(0, 10)} 的数据覆盖期间` : '当前数据覆盖期间'}，${template.question}${template.context ? '\n' + template.context : ''}`;
}
