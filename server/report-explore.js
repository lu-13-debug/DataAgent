import { Worker } from 'node:worker_threads';
import { SCHEMA, analyze, analysisRange, dateOf, normalizeRecords, round, shiftDate, yesterday } from './analytics.js';
import { maskSkippedReport } from './workflow.js';

const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const timeFields = { users: 'registered_at', activity: 'event_time', payments: 'paid_at' };
const successful = new Set(['success', 'paid', 'completed', 'succeeded', '成功', '支付成功', '已支付', '1']);
export const REPORT_EXPLORE_TIMEOUT_MESSAGE = '报告探索计算超时，请缩小日期或渠道范围后重试';

export function assertExplorationSource(dataset) {
  const records = dataset?.records;
  if (!records || typeof records !== 'object' || Array.isArray(records)) throw failure('报告源数据结构不可用；须为标准表名对应数组的对象，请重新上传后分析', 409);
  const tables = Object.entries(records);
  if (tables.some(([type, rows]) => !Object.hasOwn(SCHEMA, type) || !Array.isArray(rows)) || !tables.some(([, rows]) => rows.length > 0)) throw failure('报告源数据结构不可用；仅支持数组形式的 users、activity、payments 表，且至少一张表非空，请重新上传后分析', 409);
  return records;
}

export function explorationInput(body, task) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure('探索条件须为 JSON 对象');
  let range;
  try { range = analysisRange(body); } catch (error) { throw failure(error.message); }
  if (body.channels !== undefined && (!Array.isArray(body.channels) || body.channels.length > 50 || body.channels.some(name => typeof name !== 'string' || !name.trim() || name.length > 100))) throw failure('渠道须为最多 50 项、每项 1–100 字的文本数组');
  if (body.comparePrevious !== undefined && typeof body.comparePrevious !== 'boolean') throw failure('comparePrevious 须为布尔值');
  if (task.status !== 'completed' || !task.report) throw failure('仅已完成且有报告的任务可以探索', 409);
  const generatedAt = task.report.generatedAt;
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) throw failure('原报告缺少有效生成时间，请重新分析源数据', 409);
  if (range.end > yesterday(generatedAt)) throw failure('仅可探索原报告生成时已结束的完整自然日');
  if (body.comparePrevious && !/^[1-9]\d{3}-/.test(shiftDate(range.start, -range.length))) throw failure('上期日期超出支持范围');
  return { start: range.start, end: range.end, channels: [...new Set((body.channels || []).map(name => name.trim()))].sort(), comparePrevious: body.comparePrevious === true };
}

function tableCoverage(records, cutoff) {
  return Object.fromEntries(Object.entries(timeFields).map(([type, field]) => {
    const dates = (records[type] || []).map(row => dateOf(row[field])).sort();
    const end = dates.length ? (dates.at(-1) < cutoff ? dates.at(-1) : cutoff) : null;
    return [type, end && dates[0] <= end ? { start: dates[0], end } : null];
  }));
}
const overlaps = (coverage, type, range) => Boolean(coverage[type] && coverage[type].start <= range.end && coverage[type].end >= range.start);
const covers = (coverage, type, range) => Boolean(coverage[type] && coverage[type].start <= range.start && coverage[type].end >= range.end);

function derivedPeriod(dataset, records, task, input, coverage) {
  const generatedAt = task.report.generatedAt, skippedSteps = task.skippedSteps || [];
  const userMap = new Map((records.users || []).map(user => [user.user_id, user]));
  const selected = row => !input.channels.length || input.channels.includes(userMap.get(row.user_id)?.channel);
  const inRange = (row, field) => { const date = dateOf(row[field]); return date >= input.start && date <= input.end; };
  const rows = Object.fromEntries(Object.entries(timeFields).map(([type, field]) => [type, (records[type] || []).filter(row => selected(row) && inRange(row, field))]));
  const selectedRowsByTable = Object.fromEntries(Object.entries(rows).map(([type, values]) => [type, values.length]));
  const sourceRows = Object.values(dataset.records).reduce((total, values) => total + values.length, 0);
  const selectedRows = Object.values(selectedRowsByTable).reduce((total, count) => total + count, 0);
  const report = maskSkippedReport(analyze(dataset, { range: input, channels: input.channels, now: generatedAt, title: task.title, goal: '所选日期与渠道的运营表现' }), { datasetName: dataset.name, goal: '所选日期与渠道的运营表现', skippedSteps });
  const limited = Object.keys(timeFields).filter(type => !covers(coverage, type, input));
  const sampleNote = `确定性筛选派生：${input.start} 至 ${input.end}，${input.channels.length ? `注册渠道 ${input.channels.join('、')}` : '全部渠道'}；原始源记录 ${sourceRows} 行，筛选期及渠道内归一化记录 ${selectedRows} 行（注册 ${rows.users.length}、活跃 ${rows.activity.length}、支付 ${rows.payments.length}）。用于渠道归因的全量注册映射及期外留存回访不计为筛选期样本。${limited.length ? '部分数据表未完整覆盖筛选期；仅能据有限覆盖观察，覆盖外为无数据。' : ''}`;
  report.summary = `${dataset.source === 'demo' ? '本报告使用示例数据，不代表真实业务。' : ''}${sampleNote}${report.methodology.includes('全部可计算运营分支已跳过，仅保留质量检查。') ? '全部可计算运营分支已跳过，仅保留质量检查。' : ''}${skippedSteps.length ? '沿用原任务的用户跳过选择。' : ''}`;
  report.quality.issues = [...report.quality.issues, sampleNote];
  report.methodology = [...report.methodology, sampleNote, '本结果未调用模型；原报告的 AI 摘要、洞察、建议及模型用量不移植到筛选结果。指标 change 不表示上期比较，统一保留 null；比较见 comparison.metrics。'];
  report.metrics = report.metrics.map(metric => ({ ...metric, change: null }));
  return { report, scope: {
    start: input.start, end: input.end, channels: input.channels, timeZone: 'Asia/Shanghai', statisticsVersion: 'report-explore-v1', generatedAt, coverage,
    sample: { sourceRows, selectedRows, selectedRowsByTable,
      registeredUsers: overlaps(coverage, 'users', input) ? rows.users.length : null,
      payingUsers: !skippedSteps.includes('monetization') && overlaps(coverage, 'payments', input) ? new Set(rows.payments.filter(row => successful.has(row.status)).map(row => row.user_id)).size : null,
    }, skippedSteps: [...skippedSteps],
  } };
}

function compareMetrics(current, previous, coverage, skippedSteps) {
  const requirements = { dau: ['activity'], new_users: ['users'], d1_retention: ['users'], d7_retention: ['users'], revenue: ['payments'], arppu: ['payments'], pay_rate: ['activity', 'payments'], arpdau: ['activity', 'payments'] };
  return current.report.metrics.map(metric => {
    const prior = previous.report.metrics.find(item => item.id === metric.id)?.value ?? null;
    let reason = null;
    if ((skippedSteps.includes('retention') && ['d1_retention', 'd7_retention'].includes(metric.id)) || (skippedSteps.includes('monetization') && ['revenue', 'arppu', 'pay_rate', 'arpdau'].includes(metric.id))) reason = '原任务已跳过此分析分支';
    if (!reason && (requirements[metric.id] || []).some(type => !covers(coverage, type, current.scope) || !covers(coverage, type, previous.scope))) reason = '当前期或上期的源表未完整覆盖等长区间';
    if (!reason && ['d1_retention', 'd7_retention'].includes(metric.id)) {
      const key = metric.id === 'd1_retention' ? 'd1' : 'd7';
      if ([current.report, previous.report].some(report => !report.retention.length || report.retention.some(cohort => cohort[key] === null))) reason = '当前期或上期留存 cohort 不成熟、观察覆盖不足或没有注册样本';
    }
    if (!reason && (metric.value === null || prior === null)) reason = '当前期或上期无可用指标或有效分母';
    if (!reason && prior === 0) reason = '上期值为零，无法形成可靠的比例比较';
    return { id: metric.id, comparable: !reason, reason, current: metric.value, previous: prior, absoluteChange: reason ? null : round(metric.value - prior), percentChange: reason ? null : round((metric.value - prior) * 100 / prior) };
  });
}

export function computeExploration(dataset, task, body) {
  const input = explorationInput(body, task);
  assertExplorationSource(dataset);
  let records;
  try { ({ records } = normalizeRecords(dataset.records, dataset.warnings || [])); }
  catch { throw failure('报告源数据结构无法安全分析，请核对后重新上传', 409); }
  if (input.channels.length && !records.users?.length) throw failure('缺少注册表，无法按注册渠道筛选');
  if (input.channels.some(name => !(records.users || []).some(user => user.channel === name))) throw failure('所选渠道未出现在源注册表，请刷新渠道后重试');
  const coverage = tableCoverage(records, yesterday(task.report.generatedAt));
  const current = derivedPeriod(dataset, records, task, input, coverage);
  if (!input.comparePrevious) return { ...current, comparison: { requested: false, comparable: false, reasons: ['未请求上期比较'], metrics: [] } };
  const length = analysisRange(input).length;
  const previousRange = { start: shiftDate(input.start, -length), end: shiftDate(input.start, -1) };
  const previous = derivedPeriod(dataset, records, task, { ...input, ...previousRange }, coverage);
  const metrics = compareMetrics(current, previous, coverage, task.skippedSteps || []);
  return { ...current, previous: previous.report, previousScope: previous.scope, comparison: { requested: true, comparable: metrics.some(metric => metric.comparable), reasons: [...new Set(metrics.filter(metric => !metric.comparable).map(metric => metric.reason))], previousRange, metrics } };
}

export class ReportExplorer {
  constructor({ maxConcurrent = 2, workerFactory, timeoutMs = 30000 } = {}) {
    this.maxConcurrent = Math.max(1, Math.min(2, Number.isSafeInteger(maxConcurrent) ? maxConcurrent : 2));
    this.timeoutMs = Math.max(1, Math.min(30000, Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : 30000));
    this.workerFactory = workerFactory || (workerData => new Worker(new URL('./report-explore-worker.js', import.meta.url), { workerData, resourceLimits: { maxOldGenerationSizeMb: 512 } }));
    this.jobs = new Set(); this.closed = false;
  }
  get size() { return this.jobs.size; }
  async run(dataset, task, body, { signal } = {}) {
    if (this.closed) throw failure('报告探索服务已关闭', 503);
    if (signal?.aborted) throw Object.assign(failure('报告探索已取消', 499), { name: 'AbortError' });
    if (this.jobs.size >= this.maxConcurrent) throw failure(`当前账号最多同时执行 ${this.maxConcurrent} 个报告探索，请稍后重试`, 429);
    const input = explorationInput(body, task);
    assertExplorationSource(dataset);
    return new Promise((resolve, reject) => {
      // Only calculation inputs cross the worker boundary: never credentials, model context or AI prose.
      const startedAt = performance.now();
      const worker = this.workerFactory({ dataset: { id: dataset.id, name: dataset.name, source: dataset.source, warnings: dataset.warnings, records: dataset.records }, task: { status: task.status, title: task.title, datasetName: task.datasetName, skippedSteps: task.skippedSteps, report: { generatedAt: task.report.generatedAt } }, input });
      let finished = false, timer;
      const finish = async (error, result) => {
        if (finished) return; finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        worker.removeAllListeners('message'); worker.removeAllListeners('error'); worker.removeAllListeners('exit');
        worker.on('error', () => {});
        try { await worker.terminate(); } catch { /* An already exited worker has no live resources. */ }
        this.jobs.delete(job);
        if (error) reject(error); else resolve(result);
      };
      const abort = () => { void finish(Object.assign(failure('报告探索已取消', 499), { name: 'AbortError' })); };
      const job = { close: () => { void finish(failure('服务关闭，报告探索已取消', 503)); } };
      this.jobs.add(job); signal?.addEventListener('abort', abort, { once: true });
      worker.once('message', message => { if (message.error) void finish(failure(message.error, message.status || 400)); else void finish(null, message.result); });
      worker.once('error', () => { void finish(failure('报告探索计算失败，请缩小范围或重试', 500)); });
      worker.once('exit', () => { void finish(failure('报告探索计算已中断，请重试', 500)); });
      const remaining = this.timeoutMs - (performance.now() - startedAt);
      const timeout = () => { void finish(Object.assign(failure(REPORT_EXPLORE_TIMEOUT_MESSAGE, 503), { code: 'REPORT_EXPLORE_TIMEOUT' })); };
      if (remaining <= 0) timeout(); else { timer = setTimeout(timeout, remaining); timer.unref(); }
      if (signal?.aborted) abort();
    });
  }
  close() { if (this.closed) return; this.closed = true; for (const job of this.jobs) job.close(); }
}
