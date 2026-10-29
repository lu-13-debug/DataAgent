import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { ExploreScope, Report, Task } from '../types';
import { channelTablePage } from '../report-tables';
import { reportCsv, exportFilename } from '../report-export';
import { downloadText, number } from './ui';
export function ReportChannelsTable({ report, task, scope }: { report: Report; task: Task; scope?: ExploreScope }) {
  const [query, setQuery] = useState(''); const [page, setPage] = useState(0); const [error, setError] = useState('');
  const table = useMemo(() => channelTablePage(report.channels, query, page), [report.channels, query, page]);
  const start = scope?.start || report.daily[0]?.date || '', end = scope?.end || report.daily.at(-1)?.date || '';
  function exportCurrentTable() {
    setError('');
    try { downloadText(exportFilename(task.title, start, end, 'channels-table', 'csv'), reportCsv({ ...report, channels: table.matches }, 'channels', scope, query.trim() ? `渠道名称包含「${query.trim()}」；共 ${table.matched} 个匹配` : '未按渠道名称筛选；导出本表全部匹配结果')); }
    catch { setError('渠道表 CSV 导出失败，请重试。'); }
  }
  return <section className="report-channel-details" aria-label="渠道明细表">
    <div className="report-table-controls no-print"><label>渠道名称搜索<input type="search" aria-label="搜索渠道明细" maxLength={100} value={query} placeholder="只筛选此表，不改变报告统计" onChange={event => { setQuery(event.target.value); setPage(0); }} /></label><button className="button secondary" onClick={exportCurrentTable}><Download size={14} />导出当前表 CSV</button></div>
    <p className="field-help">本表 {number(table.matched)} / {number(report.channels.length)} 个渠道，当前第 {table.page + 1} / {table.pages} 页。名称搜索只影响此表；全局统计范围见上方。{query && ` 名称包含「${query}」。`}</p>
    <div className="table-scroll"><table className="data-table report-channel-table"><caption className="report-table-caption">当前页渠道明细 · 完整匹配结果可导出当前表 CSV</caption><thead><tr><th>注册渠道</th><th>新增玩家</th><th>归属玩家收入（{report.currency}）</th><th>成熟群体 D1</th></tr></thead><tbody>{table.rows.map(channel => <tr key={channel.name}><th scope="row">{channel.name}</th><td>{number(channel.users)}</td><td>{number(channel.revenue, 2)}</td><td>{channel.d1 === null ? '—' : `${number(channel.d1, 2)}%`}</td></tr>)}</tbody></table></div>
    {!table.rows.length && <p className="field-help">{report.channels.length ? '没有匹配的渠道，请缩短搜索词。' : '没有可用注册渠道；请补齐注册表与渠道信息。当前数据无法进行渠道对比。'}</p>}
    <p className="field-help">“—”表示缺少覆盖、观察期未成熟或原任务跳过，并非零。请展开指标口径和数据质量说明核对。</p>
    <div className="report-table-pagination no-print"><span>每页最多 {table.pageSize} 行</span><button className="button secondary" disabled={table.page === 0} onClick={() => setPage(table.page - 1)}>上一页渠道明细</button><button className="button secondary" disabled={table.page + 1 >= table.pages} onClick={() => setPage(table.page + 1)}>下一页渠道明细</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
