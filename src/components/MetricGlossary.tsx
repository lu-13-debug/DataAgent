import type { Report } from '../types';
export function MetricGlossary({ report }: { report: Report }) {
  return <details className="metric-glossary"><summary>查看指标口径与术语</summary><p>日活跃玩家（DAU）按用户去重；D1 / D7 分别观察注册后第 1 / 7 个自然日。缺少覆盖与未成熟样本不等同于零，百分比的绝对差用“百分点”表示。</p><dl>{report.metrics.map(metric => <div key={metric.id}><dt>{metric.label}{metric.unit ? `（${metric.unit}）` : ''}</dt><dd>{metric.note || '本报告未提供可确认的统计定义。'}</dd></div>)}</dl></details>;
}
