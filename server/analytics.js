const DAY = 86400000;
export const SCHEMA = {
  users: ['user_id', 'registered_at', 'channel'],
  activity: ['user_id', 'event_time'],
  payments: ['order_id', 'user_id', 'paid_at', 'amount', 'currency', 'status'],
};
export const dateOf = value => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10);
export const shiftDate = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const yesterday = (now = new Date()) => shiftDate(dateOf(now), -1);
export const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const pct = (n, d) => d ? round(100 * n / d) : null;

export function timestamp(value, label = '时间') {
  let raw = value instanceof Date ? value.toISOString() : String(value ?? '').trim();
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(raw)) raw = raw.replaceAll('/', '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += 'T00:00:00+08:00';
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)) raw = raw.replace(' ', 'T') + '+08:00';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) || !Number.isFinite(Date.parse(raw))) throw new Error(`${label}无效，请使用 ISO 日期时间（无时区时按 Asia/Shanghai）`);
  const originalDay = raw.slice(0, 10);
  const check = new Date(`${originalDay}T00:00:00Z`);
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== originalDay) throw new Error(`${label}无效`);
  return new Date(raw).toISOString();
}

export function moneyCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('支付金额无效：必须为非负数，最多两位小数，单位为元');
  const [whole, part = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(part.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 1e14) throw new Error('支付金额超出可安全计算范围');
  return cents;
}

export function normalizeRecords(input, initialWarnings = []) {
  const records = {};
  const warnings = [...initialWarnings];
  for (const [type, rows] of Object.entries(input)) {
    if (!SCHEMA[type] || !Array.isArray(rows)) continue;
    const seen = new Map();
    records[type] = [];
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const row = {};
      for (const field of SCHEMA[type]) {
        if (raw[field] === undefined || raw[field] === null || String(raw[field]).trim() === '') {
          if (field === 'channel') row[field] = '未标记渠道';
          else throw new Error(`${type} 第 ${i + 2} 行缺少 ${field}`);
        } else row[field] = String(raw[field]).trim();
      }
      const timeField = type === 'users' ? 'registered_at' : type === 'activity' ? 'event_time' : 'paid_at';
      row[timeField] = timestamp(raw[timeField], `${type} 第 ${i + 2} 行时间`);
      if (type === 'payments') {
        row.amount = moneyCents(row.amount) / 100;
        row.currency = row.currency.toUpperCase();
        if (!/^[A-Z]{3}$/.test(row.currency)) throw new Error('币种须使用 CNY / USD 等三位代码');
        row.status = row.status.toLowerCase();
      }
      const key = type === 'users' ? row.user_id : type === 'payments' ? row.order_id : null;
      if (key && seen.has(key)) {
        const existing = seen.get(key);
        if (type === 'payments') {
          const same = SCHEMA.payments.every(k => existing[k] === row[k]);
          if (!same) throw new Error(`重复订单 ${key} 的金额、用户、状态或时间冲突，请先核对数据`);
          warnings.push('检测到重复订单，已按 order_id 去重');
        } else {
          warnings.push('检测到重复用户，注册时间取最早记录');
          if (row.registered_at < existing.registered_at) Object.assign(existing, row);
        }
        continue;
      }
      if (key) seen.set(key, row);
      records[type].push(row);
    }
  }
  const currencies = new Set((records.payments || []).map(p => p.currency));
  if (currencies.size > 1) throw new Error('检测到混合币种；请先拆分币种或按明确汇率转换，系统不会直接合并');
  return { records, warnings: [...new Set(warnings)] };
}

export function analyze(dataset, options = {}) {
  const now = options.now || new Date();
  const { records: r, warnings } = normalizeRecords(dataset.records || {}, dataset.warnings || []);
  const has = type => Object.hasOwn(r, type);
  const users = r.users || [], activity = r.activity || [], payments = r.payments || [];
  const issues = [...warnings];
  for (const [type, label] of [['users', '注册'], ['activity', '活跃'], ['payments', '支付']]) if (!has(type)) issues.push(`缺少${label}表，相关指标显示无数据`);
  const cutoff = yesterday(now);
  const allDates = [...users.map(x => dateOf(x.registered_at)), ...activity.map(x => dateOf(x.event_time)), ...payments.map(x => dateOf(x.paid_at))].sort();
  if (!allDates.length) throw new Error('数据集中没有可分析的数据行');
  const start = allDates[0];
  const end = allDates.at(-1) > cutoff ? cutoff : allDates.at(-1);
  if (start > end) throw new Error('数据仅包含当日或未来日期，尚无完整自然日可分析');
  const length = Math.floor((Date.parse(end) - Date.parse(start)) / DAY) + 1;
  if (length > 3660) throw new Error('数据时间跨度超过十年，请缩小分析范围');
  if (allDates.some(d => d > end)) issues.push(`已排除 ${shiftDate(end, 1)} 起的当日或未来记录，避免使用不完整自然日`);
  const labels = { users: '注册表', activity: '活跃表', payments: '支付表' };
  const timeFields = { users: 'registered_at', activity: 'event_time', payments: 'paid_at' };
  const coverage = {};
  for (const [type, rows] of Object.entries(r)) {
    const dates = rows.map(row => dateOf(row[timeFields[type]])).sort();
    const tableEnd = dates.length ? (dates.at(-1) < cutoff ? dates.at(-1) : cutoff) : null;
    coverage[type] = tableEnd && dates[0] <= tableEnd ? { start: dates[0], end: tableEnd } : null;
    if (!coverage[type]) issues.push(`${labels[type]}没有完整自然日覆盖，相关指标显示无数据`);
  }
  const covered = (type, date) => Boolean(date && coverage[type] && date >= coverage[type].start && date <= coverage[type].end);
  const ranges = Object.entries(coverage).filter(([, range]) => range);
  if (new Set(ranges.map(([, range]) => `${range.start}/${range.end}`)).size > 1) {
    issues.push(`跨表覆盖范围不一致：${ranges.map(([type, range]) => `${labels[type]} ${range.start} 至 ${range.end}`).join('；')}。各表覆盖范围之外显示无数据，不按零补齐。`);
  }
  const active = new Map(), registered = new Map(), paid = new Map(), revenue = new Map();
  const addSet = (map, key, id) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id); };
  for (const row of activity) { const date = dateOf(row.event_time); if (date <= end) addSet(active, date, row.user_id); }
  const activityCovered = date => covered('activity', date);
  const userMap = new Map(users.map(u => [u.user_id, u]));
  for (const row of users) { const date = dateOf(row.registered_at); if (date <= end) addSet(registered, date, row.user_id); }
  const successful = new Set(['success', 'paid', 'completed', 'succeeded', '成功', '支付成功', '已支付', '1']);
  const success = payments.filter(p => successful.has(p.status) && dateOf(p.paid_at) <= end);
  const excluded = payments.filter(p => !successful.has(p.status)).length;
  if (excluded) issues.push(`${excluded} 笔非成功状态订单未计入支付指标`);
  for (const row of success) {
    const date = dateOf(row.paid_at);
    addSet(paid, date, row.user_id);
    revenue.set(date, (revenue.get(date) || 0) + moneyCents(row.amount));
  }
  const unknown = new Set([...activity, ...payments].map(x => x.user_id).filter(id => !userMap.has(id)));
  if (has('users') && unknown.size) issues.push(`${unknown.size} 位活动或支付用户未匹配注册表；不将窗口首见视为注册`);
  const daily = Array.from({ length }, (_, i) => {
    const date = shiftDate(start, i);
    return { date, dau: covered('activity', date) ? active.get(date)?.size || 0 : null, newUsers: covered('users', date) ? registered.get(date)?.size || 0 : null, revenue: covered('payments', date) ? (revenue.get(date) || 0) / 100 : null, payers: covered('payments', date) ? paid.get(date)?.size || 0 : null };
  });
  const retention = [...registered].sort(([a], [b]) => a.localeCompare(b)).map(([date, cohort]) => {
    const retained = days => {
      if (!has('activity') || !activityCovered(shiftDate(date, days))) return null;
      const returned = active.get(shiftDate(date, days)) || new Set();
      return pct([...cohort].filter(id => returned.has(id)).length, cohort.size);
    };
    return { date, users: cohort.size, d1: retained(1), d7: retained(7) };
  });
  const weightedRetention = (rows, key) => {
    const mature = rows.filter(c => c[key] !== null);
    const total = mature.reduce((n, c) => n + c.users, 0);
    return total ? round(mature.reduce((n, c) => n + c.users * c[key], 0) / total) : null;
  };
  const totalCents = [...revenue.values()].reduce((n, v) => n + v, 0);
  if (!Number.isSafeInteger(totalCents)) throw new Error('支付总额超出可安全计算范围');
  const payerIds = new Set(success.map(p => p.user_id));
  const activeEnd = coverage.activity?.end || null;
  const last = daily.find(day => day.date === activeEnd) || { dau: null };
  const previous = activeEnd ? daily.find(day => day.date === shiftDate(activeEnd, -1)) : undefined;
  const lastActive = active.get(activeEnd) || new Set(), lastPaid = paid.get(activeEnd) || new Set();
  const sameDayPaymentCoverage = covered('payments', activeEnd);
  const activeDayNote = activeEnd ? `${activeEnd} 最后完整活跃覆盖自然日` : '没有完整活跃覆盖自然日';
  const sameDayPaymentNote = activeEnd && !sameDayPaymentCoverage ? '；该日不在支付表覆盖范围内，显示无数据' : '';
  const change = (value, prev) => value === null || !prev ? null : round((value - prev) * 100 / prev);
  const currency = payments[0]?.currency || 'CNY';
  const currencyUnit = currency === 'CNY' ? '元' : currency;
  const registeredPeriod = coverage.users ? `${coverage.users.start} 至 ${coverage.users.end}` : '没有完整注册覆盖自然日';
  const paymentPeriod = coverage.payments ? `${coverage.payments.start} 至 ${coverage.payments.end}` : '没有完整支付覆盖自然日';
  const metric = (id, label, value, unit, note, delta = null) => ({ id, label, value, unit, change: delta, note });
  const metrics = [
    metric('dau', '日活跃用户', last.dau, '人', `${activeDayNote}；按 user_id 去重`, change(last.dau, previous?.dau)),
    metric('new_users', '新增注册用户', coverage.users ? users.filter(u => dateOf(u.registered_at) <= end).length : null, '人', `${registeredPeriod}；以注册表为准`),
    metric('d1_retention', '次日留存率', has('users') && has('activity') ? weightedRetention(retention, 'd1') : null, '%', '按注册人数加权，仅包含 D1 已成熟 cohort；第 1 天当日回访'),
    metric('d7_retention', '7日留存率', has('users') && has('activity') ? weightedRetention(retention, 'd7') : null, '%', '按注册人数加权，仅包含 D7 已成熟 cohort；第 7 天当日回访'),
    metric('revenue', '成功支付收入', coverage.payments ? totalCents / 100 : null, currencyUnit, `${paymentPeriod}；成功订单按 order_id 去重；金额以整数分计算`),
    metric('arppu', '付费用户平均收入', coverage.payments ? (payerIds.size ? round(totalCents / 100 / payerIds.size) : null) : null, currencyUnit, `${paymentPeriod}；成功支付总额 / 去重付费人数`),
    metric('pay_rate', '活跃付费率', activeEnd && sameDayPaymentCoverage ? pct([...lastActive].filter(id => lastPaid.has(id)).length, lastActive.size) : null, '%', `${activeDayNote}；活跃且支付用户 / DAU${sameDayPaymentNote}`),
    metric('arpdau', '日活跃用户平均收入', activeEnd && sameDayPaymentCoverage && lastActive.size ? round((revenue.get(activeEnd) || 0) / 100 / lastActive.size) : null, currencyUnit, `${activeDayNote}；当日成功支付总额 / DAU${sameDayPaymentNote}`),
  ];
  const channelNames = [...new Set(users.filter(u => dateOf(u.registered_at) <= end).map(u => u.channel))];
  const channels = channelNames.map(name => {
    const ids = new Set(users.filter(u => u.channel === name && dateOf(u.registered_at) <= end).map(u => u.user_id));
    const channelCohorts = [...registered].map(([date, cohort]) => {
      const members = [...cohort].filter(id => ids.has(id));
      const returned = active.get(shiftDate(date, 1)) || new Set();
      return { users: members.length, d1: has('activity') && activityCovered(shiftDate(date, 1)) ? pct(members.filter(id => returned.has(id)).length, members.length) : null };
    });
    return { name, users: ids.size, revenue: coverage.payments ? success.filter(p => ids.has(p.user_id)).reduce((n, p) => n + moneyCents(p.amount), 0) / 100 : null, d1: weightedRetention(channelCohorts, 'd1') };
  }).sort((a, b) => b.users - a.users);
  const totalRows = Object.values(dataset.records || {}).reduce((n, rows) => n + rows.length, 0);
  const demo = dataset.source === 'demo' ? '本报告使用确定性生成的示例数据，不代表真实业务。' : '';
  const goal = options.goal || '了解活跃、留存和商业化表现';
  const context = (options.messages || []).filter(m => m.role === 'user').map(m => m.content).join('；');
  const findings = [
    { title: '完整自然日活跃', detail: last.dau === null ? '缺少完整自然日活跃覆盖，无法判断活跃表现。' : `${activeEnd} 共有 ${last.dau} 位活跃用户，重复事件已去重。`, severity: 'neutral', evidence: last.dau === null ? '没有完整活跃覆盖日' : `${activeEnd} DAU = ${last.dau}` },
    { title: '留存观察', detail: metrics[2].value === null ? '尚无可用的成熟注册 cohort，不能推断留存。' : `成熟 cohort 的加权次日留存率为 ${metrics[2].value}%，应结合渠道与样本量判断。`, severity: metrics[2].value !== null && metrics[2].value < 30 ? 'warning' : 'neutral', evidence: `成熟 cohort ${retention.filter(c => c.d1 !== null).length} 组` },
    { title: '商业化口径', detail: coverage.payments ? `${paymentPeriod} 成功支付收入 ${totalCents / 100} ${currency}，去重付费人数 ${payerIds.size}。` : '未提供完整支付覆盖，商业化指标无数据。', severity: 'neutral', evidence: coverage.payments ? `${success.length} 笔成功订单；以整数分累加` : '没有完整支付覆盖日' },
  ];
  if (issues.length) findings.push({ title: '数据质量提示', detail: issues.join('；'), severity: 'warning', evidence: `${issues.length} 项质量提示` });
  const recommendations = [
    `围绕“${goal}”，先核对指标口径与完整自然日覆盖范围，再比较渠道 cohort。`,
    channels.length ? `优先复核 ${channels[0].name} 渠道的新增与留存，结合样本量安排后续验证。` : '补充带有注册时间和渠道的注册表，以支持渠道和生命周期分析。',
    context ? `结合追加背景“${context}”安排渠道分组、活动复盘或验证实验；现有数据只能支持观察性结论。` : '将渠道成本、活动日历和版本变更补充为业务背景，再验证观察到的变化。',
  ];
  return {
    title: options.title ? `${options.title} · 运营分析报告` : `${dataset.name} · 运营分析报告`,
    period: `${start} 至 ${end}`, generatedAt: new Date(now).toISOString(), currency,
    summary: `${demo}围绕“${goal}”分析 ${start} 至 ${end} 的 ${totalRows} 行记录。${last.dau === null ? '活跃指标无数据' : `${activeEnd} 最后完整活跃覆盖日 DAU 为 ${last.dau}`}；${coverage.payments ? `${paymentPeriod} 成功支付收入为 ${totalCents / 100} ${currency}` : '支付指标无数据'}。${context ? `已纳入追加背景：${context}。` : ''}`,
    findings, recommendations, metrics, daily, retention, channels,
    quality: { rows: totalRows, issues: [...new Set(issues)], score: Math.max(0, 100 - issues.length * 5) },
    methodology: [
      '项目时区为 Asia/Shanghai（UTC+8）；无时区输入按此解释；仅使用完整自然日，排除当日和未来记录。历史文件末日视为其声明的数据覆盖末日，若该日导出不完整须重新上传。',
      'DAU 为当日活跃 user_id 去重数；新增以 users.registered_at 为准，活动窗口首见不作为注册或生命周期起点。',
      '图表保留三表日期并集；每张表分别以自身最早记录至最后完整覆盖日作为覆盖范围。范围外显示无数据，范围内的无事件日才记为零；跨表范围不一致会给出质量提示。',
      'D1 / D7 为注册日 cohort 在第 1 / 7 个自然日当天回访的比例；目标日必须落在活跃表覆盖范围内且不晚于完整自然日，按成熟 cohort 人数加权；窗口不成熟、覆盖不足或缺少表时显示无数据。',
      '支付仅统计成功状态，按 order_id 去重；金额以整数分累加，不混合币种。非 CNY 金额保留原币种，不自动换汇。',
      'DAU、活跃付费率和 ARPDAU 使用最后完整活跃覆盖自然日；付费率为该日活跃与支付用户交集 / DAU，ARPDAU 为该日成功支付总额 / DAU。支付表不覆盖该日时两者均无数据；ARPPU 为支付覆盖全期间成功支付额 / 去重付费人数；无分母显示无数据。',
      '渠道来自注册表；未匹配注册表的支付不会归属已知渠道。报告为观察性分析，不能直接推断因果。',
    ], source: 'local',
  };
}
