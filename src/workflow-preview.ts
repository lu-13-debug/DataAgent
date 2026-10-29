import type { Dataset, Task } from './types';
const definitions: Record<string, { tables: string[]; dependency?: string; output: string }> = {
  quality: { tables: [], dependency: '本次所选各表与字段', output: '字段、日期覆盖与质量提示' },
  plan: { tables: [], dependency: '分析目标、已填背景和数据覆盖', output: '指标范围与统计口径' },
  activity: { tables: ['activity'], output: '按日活跃与新增（新增另需注册表）' },
  retention: { tables: ['users', 'activity'], output: '成熟注册 cohort 的 D1 / D7 留存表' },
  monetization: { tables: ['payments'], output: '成功支付收入、ARPPU；活跃付费率另需活跃表' },
  insights: { tables: [], dependency: '可用聚合指标与覆盖限制', output: '带数据依据的观察与建议' },
  report: { tables: [], dependency: '聚合指标、目标与已填业务背景', output: '完整运营报告，可下载 Markdown / 打印 PDF' },
  verify: { tables: [], dependency: '本次报告指标与统计口径', output: '数值、完整自然日、空值与比例核验' },
};
export function workflowPreview(task: Pick<Task, 'currentStep' | 'steps'>, dataset?: Pick<Dataset, 'tables'>) {
  return task.steps.slice(task.currentStep).map(step => {
    const definition = definitions[step.id] || { tables: [], output: '执行记录与结果摘要' };
    return { ...step, ...definition, missing: dataset ? definition.tables.filter(table => !dataset.tables.some(item => item.type === table)) : [], knownCoverage: Boolean(dataset) };
  });
}
