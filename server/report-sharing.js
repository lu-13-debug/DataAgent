// Only fixed labels and numeric, bounded aggregate fields cross the public boundary.
const defs = {
  dau: ['日活跃用户', '人'], new_users: ['新增注册用户', '人'], d1_retention: ['次日留存率', '%'], d7_retention: ['7日留存率', '%'],
  revenue: ['成功支付收入', ''], arppu: ['付费用户平均收入', ''], pay_rate: ['活跃付费率', '%'], arpdau: ['日活跃用户平均收入', '']
};
const safeNumber = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e15 ? n : null;
const date = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const parsed = new Date(`${s}T00:00:00Z`); return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === s ? s : null;
};
const range = (start, end) => date(start) && date(end) && start <= end ? {start,end} : null;
const methods = { dau:'最后完整活跃覆盖日的去重活跃用户数。', new_users:'注册表覆盖期间的注册用户数。', d1_retention:'成熟注册 cohort 次日回访率，按注册人数加权。', d7_retention:'成熟注册 cohort 第七日回访率，按注册人数加权。', revenue:'覆盖期间成功支付订单金额，订单去重。', arppu:'覆盖期间成功支付总额除以去重付费人数。', pay_rate:'最后完整活跃覆盖日的活跃且付费人数除以活跃人数。', arpdau:'最后完整活跃覆盖日的成功支付总额除以活跃人数。' };
function coverage(id, metric) {
  if (safeNumber(metric.value) === null || typeof metric.note !== 'string') return null;
  let match;
  if (['dau','pay_rate','arpdau'].includes(id)) {
    const suffix = id === 'dau' ? '；按 user_id 去重' : id === 'pay_rate' ? '；活跃且支付用户 / DAU' : '；当日成功支付总额 / DAU';
    const pattern = /^(\d{4}-\d{2}-\d{2}) 最后完整活跃覆盖自然日(.*)$/;
    match = pattern.exec(metric.note);
    return match && match[2] === suffix ? range(match[1], match[1]) : null;
  }
  const suffixes = { new_users:'；以注册表为准', revenue:'；成功订单按 order_id 去重；金额以整数分计算', arppu:'；成功支付总额 / 去重付费人数' };
  if (!suffixes[id]) return null;
  match = /^(\d{4}-\d{2}-\d{2}) 至 (\d{4}-\d{2}-\d{2})(.*)$/.exec(metric.note);
  return match && match[3] === suffixes[id] ? range(match[1],match[2]) : null;
}
function metricMethod(id, metric) {
  if (coverage(id, metric)) return methods[id];
  const retentionNotes = { d1_retention:'按注册人数加权，仅包含 D1 已成熟 cohort；第 1 天当日回访', d7_retention:'按注册人数加权，仅包含 D7 已成熟 cohort；第 7 天当日回访' };
  return safeNumber(metric.value) !== null && retentionNotes[id] === metric.note ? methods[id] : null;
}
export function shareSnapshot(report, hideRevenue, datasetSource) {
  const allowed = hideRevenue ? ['dau','new_users','d1_retention','d7_retention'] : Object.keys(defs);
  const metrics = allowed.flatMap(id => {
    const m = Array.isArray(report.metrics) ? report.metrics.find(x => x?.id === id) : null;
    if (!m) return [];
    return [{ id, label: defs[id][0], value: safeNumber(m.value), unit: defs[id][1], coverage:coverage(id, m), method:metricMethod(id, m) }];
  });
  const daily = (Array.isArray(report.daily) ? report.daily : []).slice(0, 366).flatMap(row => {
    const d = date(row?.date); if (!d) return [];
    return [{ date:d, dau:safeNumber(row.dau), newUsers:safeNumber(row.newUsers), ...(!hideRevenue ? { revenue:safeNumber(row.revenue), payers:safeNumber(row.payers) } : {}) }];
  });
  const retention = (Array.isArray(report.retention) ? report.retention : []).slice(0, 366).flatMap(row => {
    const d = date(row?.date); return d ? [{ date:d, users:safeNumber(row.users), d1:safeNumber(row.d1), d7:safeNumber(row.d7) }] : [];
  });
  const periodMatch = typeof report.period === 'string' ? /^(\d{4}-\d{2}-\d{2}) 至 (\d{4}-\d{2}-\d{2})$/.exec(report.period) : null;
  const sample = datasetSource === 'demo' ? true : datasetSource === 'upload' ? false : null;
  return { source: report.source === 'ai' ? 'ai' : 'local', hideRevenue,
    sample, sampleNotice: sample === true ? '本报告使用示例数据，不代表真实业务。' : sample === false ? '数据源标记为上传数据。' : '数据来源是否为示例未知。',
    period: periodMatch ? range(periodMatch[1], periodMatch[2]) : null,
    dailyTruncated: Array.isArray(report.daily) && report.daily.length > 366,
    retentionTruncated: Array.isArray(report.retention) && report.retention.length > 366, ...(!hideRevenue ? { currency: ['CNY','USD','EUR','GBP','JPY','HKD','TWD','KRW','SGD','AUD','CAD'].includes(report.currency) ? report.currency : null } : {}), metrics, daily, retention,
    methodology: ['无法确认的指标覆盖日期和口径标记为未知；图表最多显示前 366 条。'] };
}
