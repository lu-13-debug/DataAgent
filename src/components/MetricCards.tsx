import { Activity, ArrowDownRight, ArrowUpRight, CircleHelp, Coins, TrendingUp, Users } from 'lucide-react';
import type { ExploreMetricComparison, Exploration, Report } from '../types';
import { number } from './ui';
const definitions = [{ id: 'dau', label: '日活跃玩家', icon: Users, fallback: 'DAU' }, { id: 'new_users', label: '新增玩家', icon: Activity, fallback: '新增' }, { id: 'd1_retention', label: '次日留存率', icon: TrendingUp, fallback: '次日' }, { id: 'revenue', label: '期间支付收入', icon: Coins, fallback: '收入' }];
function PeriodChange({ comparison, unit }: { comparison?: ExploreMetricComparison; unit: string }) {
  if (!comparison?.comparable) return <span className="metric-comparison-note">上期不可比：{comparison?.reason || '缺少可确认的比较结果'}</span>;
  return <span className="metric-comparison-note">较上期同口径：{comparison.absoluteChange! > 0 ? '+' : ''}{number(comparison.absoluteChange, 2)} {unit === '%' ? '个百分点' : unit}{unit !== '%' && <>，变化率 {comparison.percentChange! > 0 ? '+' : ''}{number(comparison.percentChange, 2)}%</>}</span>;
}
export function MetricCards({ report, result }: { report: Report; result?: Exploration }) {
  return <div className="metrics-grid">{definitions.map(definition => {
    const metric = report.metrics.find(item => item.id === definition.id) || report.metrics.find(item => item.label.includes(definition.fallback));
    const comparison = result?.comparison.metrics.find(item => item.id === metric?.id);
    return <section className="metric-card" key={definition.id} aria-label={definition.label}>
      <div className="metric-label"><span>{definition.label}</span><definition.icon size={15} strokeWidth={1.6} /></div>
      <div className="metric-value">{definition.id === 'revenue' && metric?.value != null && <span className="currency">{report.currency === 'CNY' ? '¥' : `${report.currency} `}</span>}{number(metric?.value, definition.id === 'd1_retention' ? 1 : definition.id === 'revenue' ? 2 : 0)}{definition.id === 'd1_retention' && metric?.value != null && <small>%</small>}</div>
      <div className="metric-bottom">{result?.comparison.requested ? <PeriodChange comparison={comparison} unit={metric?.unit || ''} /> : metric?.change != null ? <><span className={`metric-change ${metric.change >= 0 ? 'up' : 'down'}`}>{metric.change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(metric.change).toFixed(1)}%</span><span>较前一自然日</span></> : <span>{metric?.note || '暂无足够数据'}</span>}<span className="metric-info" title={metric?.note || '展开下方指标口径说明'}><CircleHelp size={12} /></span></div>
    </section>;
  })}</div>;
}
