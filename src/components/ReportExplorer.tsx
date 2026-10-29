import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Activity, Download, FileText, Filter, RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '../auth-context';
import { annotationStorageKey, annotationTypeLabels, brushIndices, isCalendarDate, linePaths, metricComparison, readAnnotationState, saveAnnotations, scopeLabel, trendRows, trendScrollLeft } from '../report-explorer';
import type { AnnotationType, ReportAnnotation, TrendRow } from '../report-explorer';
import { exportFilename, exportTrendPng, reportCsv } from '../report-export';
import type { ReportCsvKind } from '../report-export';
import type { ReportExplorerState } from '../use-report-explorer';
import type { Exploration, Task } from '../types';
import { downloadText, number } from './ui';
import '../report-explorer.css';

interface ExplorerProps { task: Task; explorer: ReportExplorerState }
function appliedLabel(explorer: ReportExplorerState) {
  return scopeLabel(explorer.appliedScope, `原始报告 · ${explorer.originalRange.start || '未知开始日'} 至 ${explorer.originalRange.end || '未知结束日'} · 全部渠道`);
}

export function ReportExplorer({ task, explorer }: ExplorerProps) {
  const [query, setQuery] = useState(''); const [page, setPage] = useState(0);
  useEffect(() => { setQuery(''); setPage(0); }, [task.id]);
  const names = useMemo(() => [...new Set((task.report?.channels || []).map(channel => channel.name))], [task.report]);
  const matches = useMemo(() => query.trim() ? names.filter(name => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : names, [names, query]);
  const selected = explorer.draft.channels || [];
  const pageCount = Math.max(1, Math.ceil(matches.length / 24)), currentPage = Math.min(page, pageCount - 1);
  const choices = matches.slice(currentPage * 24, (currentPage + 1) * 24);
  const report = explorer.displayReport;
  if (!report) return null;
  function toggle(name: string) {
    const channels = selected.includes(name) ? selected.filter(item => item !== name) : [...selected, name];
    if (channels.length <= 50) explorer.setDraft({ ...explorer.draft, channels });
  }
  return <section className="card rex-controls" aria-label="报告精确探索">
    <div className="rex-heading"><h3><Filter size={16} />{explorer.enabled ? '精确探索' : '报告当前视图'}</h3><span className="rex-tag">{explorer.result ? '确定性派生 · 有限数据' : '原始报告'}</span>{explorer.enabled && <small>免费 · 不调用 AI · 原件不变</small>}</div>
    {explorer.enabled ? <>
      <form className="rex-range-form no-print" onSubmit={event => { event.preventDefault(); void explorer.apply(); }}>
        <label>开始日期<input type="date" required min="1000-01-01" max={explorer.cutoff} value={explorer.draft.start} onChange={event => explorer.setDraft({ ...explorer.draft, start: event.target.value })} /></label>
        <span className="rex-date-separator" aria-hidden="true">至</span>
        <label>结束日期<input type="date" required min="1000-01-01" max={explorer.cutoff} value={explorer.draft.end} onChange={event => explorer.setDraft({ ...explorer.draft, end: event.target.value })} /></label>
        <label className="rex-compare-choice"><input type="checkbox" checked={explorer.draft.comparePrevious === true} onChange={event => explorer.setDraft({ ...explorer.draft, comparePrevious: event.target.checked })} />比较紧邻上期</label>
        <button type="submit" className="button primary" disabled={explorer.loading} aria-busy={explorer.loading}>{explorer.loading ? '正在计算…' : '应用筛选'}</button>
        <button type="button" className="button secondary" onClick={explorer.clear} disabled={!explorer.result && !explorer.dirty && !explorer.loading}><RotateCcw size={14} />清除，查看原件</button>
      </form>
      <details className="rex-channel-picker no-print"><summary>注册渠道：{selected.length ? `已选 ${selected.length} / 50` : '全部渠道'}<span>搜索并选择 · 共 {number(names.length)} 个</span></summary>
        <p className="rex-help">渠道按完整注册表归因。最多选择 50 个；不选择表示全部渠道。业务目标中的自然语言不会自动变成筛选条件。</p>
        {!!selected.length && <div className="rex-selected-channels" aria-label="已选注册渠道">{selected.map(name => <button type="button" key={name} onClick={() => toggle(name)} aria-label={`取消选择渠道 ${name}`}>{name}<span aria-hidden="true">×</span></button>)}<button type="button" onClick={() => explorer.setDraft({ ...explorer.draft, channels: [] })}>恢复全部渠道</button></div>}
        {names.length ? <><label className="rex-channel-search">搜索渠道<input type="search" value={query} placeholder="输入渠道名称" onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
          <div className="rex-channel-choices">{choices.map(name => <button type="button" className={`rex-channel-choice ${selected.includes(name) ? 'selected' : ''}`} key={name} aria-pressed={selected.includes(name)} disabled={selected.length >= 50 && !selected.includes(name)} onClick={() => toggle(name)}>{name}</button>)}</div>
          {!choices.length && <p className="rex-help">没有匹配的渠道，请调整搜索词。</p>}
          <div className="rex-pagination"><span>{number(matches.length)} 个匹配 · 第 {currentPage + 1} / {pageCount} 页，每页最多 24 个</span><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页渠道</button><button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页渠道</button></div>
        </> : <p className="rex-help">原报告没有可用的注册渠道。可继续按日期探索；如需渠道筛选，请补齐注册表和渠道字段后重新分析。</p>}
      </details>
    </> : <p className="rex-help">当前服务未声明支持精确筛选，展示原始报告完整范围。图表、表格和当前视图导出仍可使用；服务升级后可按日期与渠道精确重算。</p>}
    <div className={`rex-applied ${explorer.loading || explorer.dirty ? 'pending' : ''}`} role="status" aria-live="polite"><strong>{explorer.loading ? '正在重新计算；下方仍为已应用结果：' : explorer.dirty ? '筛选草稿尚未应用；下方仍为已应用结果：' : '当前已应用：'}</strong><span>{appliedLabel(explorer)}</span>{explorer.result && <small>核心指标、发现、留存、渠道、趋势和导出共享此范围。统计截止原报告生成时刻；覆盖外为无数据。</small>}</div>
    {explorer.error && <p className="rex-error" role="alert">{explorer.error} 下方继续保留上次已应用结果；请调整日期/渠道，或补齐源数据后重试。</p>}
    {explorer.result && <ScopeDetails result={explorer.result} />}
    {explorer.result?.comparison.requested && <Comparison result={explorer.result} />}
  </section>;
}

function ScopeDetails({ result }: { result: Exploration }) {
  const { scope } = result;
  return <details className="rex-scope-details"><summary>样本与覆盖：筛选内 {number(scope.sample.selectedRows)} 行 · 期间注册 {number(scope.sample.registeredUsers)} 人 · 唯一付费 {number(scope.sample.payingUsers)} 人</summary>
    <p className="rex-help">源记录共 {number(scope.sample.sourceRows)} 行。筛选样本为归一化后的注册 {number(scope.sample.selectedRowsByTable.users)}、活跃 {number(scope.sample.selectedRowsByTable.activity)}、支付 {number(scope.sample.selectedRowsByTable.payments)} 行；期外注册归因与留存回访不混入样本。唯一付费人数由服务端去重，不以每日人数相加。</p>
    <ul className="rex-coverage">{(['users', 'activity', 'payments'] as const).map(type => { const coverage = scope.coverage[type]; const label = { users: '注册表', activity: '活跃表', payments: '支付表' }[type]; const complete = coverage && coverage.start <= scope.start && coverage.end >= scope.end; return <li key={type}><strong>{label}：</strong>{coverage ? `${coverage.start} 至 ${coverage.end}${complete ? '，完整覆盖当前期' : '，未完整覆盖当前期；请补齐所选期源记录'}` : '缺少可用完整自然日覆盖；请补充对应源表后重新分析'}</li>; })}</ul>
    {scope.sample.selectedRows === 0 && <p className="rex-help">当前条件没有期内样本。请扩大日期范围或调整渠道；无覆盖与真实零具有不同含义。</p>}
    {scope.sample.registeredUsers == null && <p className="rex-help">注册覆盖不足，期间新增及渠道新增可能不可计算。请补齐注册表；此处的“—”不表示零。</p>}
    {!!scope.skippedSteps.length && <p className="rex-help">沿用原任务跳过选择：{scope.skippedSteps.map(id => ({ retention: '留存', monetization: '商业化', insights: '洞察' }[id] || id)).join('、')}。探索不会恢复被跳过的指标。</p>}
    <p className="rex-help">留存还需目标回访日成熟、具有活跃覆盖和注册样本；若不可计算，请补齐观察日数据。时区：{scope.timeZone} · 口径：{scope.statisticsVersion}。</p>
  </details>;
}
function Comparison({ result }: { result: Exploration }) {
  const range = result.comparison.previousRange;
  return <details className="rex-comparison" open><summary>与紧邻上期比较{range ? `：${range.start} 至 ${range.end}` : ''}</summary>
    <p className="rex-help">两期含首尾等长，使用相同渠道、冻结截止时刻和跳过选择。各指标独立检查覆盖、成熟度和有效分母；上期为零、缺数据或不可比时不展示差值。</p>
    <div className="rex-table-scroll"><table className="data-table rex-comparison-table"><caption className="rex-sr-only">当前期与上期逐项可比检查</caption><thead><tr><th>指标</th><th>当前期</th><th>上期</th><th>差值 / 比例变化</th></tr></thead><tbody>{result.report.metrics.map(item => { const comparison = metricComparison(result, item.id); return <tr key={item.id}><th scope="row">{item.label}</th><td>{number(comparison?.current ?? item.value, 2)} {comparison?.current == null && item.value == null ? '' : item.unit}</td><td>{number(comparison?.previous, 2)} {comparison?.previous == null ? '' : item.unit}</td><td>{comparison?.comparable ? <>{number(comparison.absoluteChange, 2)} {item.unit === '%' ? '个百分点' : item.unit}<small>比例变化 {comparison.percentChange! >= 0 ? '+' : ''}{number(comparison.percentChange, 2)}%</small></> : <span className="rex-help">不可比：{comparison?.reason || '无可用比较结果'}</span>}</td></tr>; })}</tbody></table></div>
  </details>;
}

export function ExplorerChart({ task, explorer }: ExplorerProps) {
  const { runtime, user } = useAuth();
  const noteBoundary = annotationStorageKey(runtime.mode, user?.id, window.location.origin, task.id);
  const [annotationState, setAnnotationState] = useState<{ key: string; list: ReportAnnotation[] }>({ key: noteBoundary, list: [] });
  const [kind, setKind] = useState<'activity' | 'revenue'>('activity'); const [view, setView] = useState<'chart' | 'table'>('chart');
  const [active, setActive] = useState(0); const [page, setPage] = useState(0); const [exporting, setExporting] = useState(false); const [exportError, setExportError] = useState('');
  const svg = useRef<SVGSVGElement>(null); const plot = useRef<HTMLDivElement>(null); const titleId = useId();
  const report = explorer.displayReport;
  const rows = useMemo(() => report ? trendRows(report, explorer.result?.previous) : [], [report, explorer.result?.previous]);
  useEffect(() => { const index = Math.max(0, rows.length - 1); setActive(index); setPage(0); setExportError(''); reveal(index); }, [report, rows.length]);
  if (!report) return null;
  const primary: keyof TrendRow = kind === 'activity' ? 'dau' : 'revenue';
  const prior: keyof TrendRow = kind === 'activity' ? 'previousDau' : 'previousRevenue';
  const max = Math.max(1, ...rows.flatMap(row => [row[primary], row[prior], ...(kind === 'activity' ? [row.newUsers, row.previousNewUsers] : [])].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))));
  const box = { left: 72, top: 116, width: 852, height: 226, max };
  const selected = rows[Math.max(0, Math.min(active, rows.length - 1))];
  const annotations = annotationState.key === noteBoundary ? annotationState.list : [];
  const selectedNotes = annotations.filter(note => note.date === selected?.date);
  const activeX = box.left + (rows.length > 1 ? Math.min(active, rows.length - 1) * box.width / (rows.length - 1) : box.width / 2);
  const range = explorer.appliedScope || { ...explorer.originalRange, channels: [] };
  const channelText = range.channels.join('、');
  const shortChannels = [...channelText].slice(0, 38).join('') + ([...channelText].length > 38 ? '…' : '');
  const previousRange = explorer.result?.comparison.previousRange;
  const valueLabel = kind === 'activity' ? '活跃玩家' : `支付收入（${report.currency}）`;
  const tooltip = selected ? `${selected.date}：${valueLabel} ${number(kind === 'activity' ? selected.dau : selected.revenue, kind === 'revenue' ? 2 : 0)}${kind === 'activity' ? `，新增 ${number(selected.newUsers)} 人` : ''}${selected.previousDate ? `；上期实际日期 ${selected.previousDate}：${valueLabel} ${number(kind === 'activity' ? selected.previousDau : selected.previousRevenue, kind === 'revenue' ? 2 : 0)}` : ''}。— 表示无数据、覆盖外或原任务跳过。${selectedNotes.length ? ` 日期批注（仅背景，不证明因果）：${selectedNotes.map(note => `${annotationTypeLabels[note.type]}：${note.text}`).join('；')}` : ''}` : '当前范围没有每日数据。';
  const pageCount = Math.max(1, Math.ceil(rows.length / 31)), currentPage = Math.min(page, pageCount - 1);
  function reveal(index: number) {
    if (plot.current && svg.current) plot.current.scrollLeft = trendScrollLeft(plot.current.clientWidth, svg.current.getBoundingClientRect().width, index, rows.length, plot.current.scrollLeft);
  }
  function csv(kind: ReportCsvKind) {
    if (!report) return; setExportError('');
    try { downloadText(exportFilename(task.title, range.start, range.end, kind, 'csv'), reportCsv(report, kind, explorer.appliedScope)); }
    catch { setExportError('CSV 导出失败，请重试或使用打印 / PDF。'); }
  }
  async function png() {
    if (!svg.current || exporting) return;
    setExporting(true); setExportError('');
    try { await exportTrendPng(svg.current, exportFilename(task.title, range.start, range.end, 'trend', 'png')); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : '趋势 PNG 导出失败，请使用每日 CSV 或打印 / PDF。'); }
    finally { setExporting(false); }
  }
  const series = [
    { key: primary, color: '#1f7a52', width: 3, dash: undefined },
    ...(kind === 'activity' ? [{ key: 'newUsers' as const, color: '#3f6f9e', width: 1.7, dash: undefined }] : []),
    ...(previousRange ? [{ key: prior, color: '#a8802f', width: 2.5, dash: '8 5' }, ...(kind === 'activity' ? [{ key: 'previousNewUsers' as const, color: '#3f6f9e', width: 1.7, dash: '3 4' }] : [])] : []),
  ];
  return <section className="card rex-chart" aria-label="当前报告趋势与导出">
    <div className="rex-heading"><h3><Activity size={16} />{kind === 'activity' ? '玩家活跃趋势' : '支付收入趋势'}</h3><span className="rex-tag">{rows.length} 个自然日</span>
      <div className="rex-chart-controls no-print"><div className="segmented small" aria-label="趋势指标"><button type="button" aria-pressed={kind === 'activity'} className={kind === 'activity' ? 'selected' : ''} onClick={() => setKind('activity')}>活跃</button><button type="button" aria-pressed={kind === 'revenue'} className={kind === 'revenue' ? 'selected' : ''} onClick={() => setKind('revenue')}>收入</button></div><div className="segmented small" aria-label="趋势展示方式"><button type="button" aria-pressed={view === 'chart'} className={view === 'chart' ? 'selected' : ''} onClick={() => setView('chart')}>图表</button><button type="button" aria-pressed={view === 'table'} className={view === 'table' ? 'selected' : ''} onClick={() => setView('table')}>表格</button></div></div>
    </div>
    <p className="rex-current-range"><strong>当前视图：</strong>{appliedLabel(explorer)}</p>
    {(explorer.loading || explorer.dirty) && <p className="rex-help rex-pending-note">{explorer.loading ? '正在重算' : '有尚未应用的草稿'}；本图、表格与导出仍对应以上已应用范围。</p>}
    {previousRange && <p className="rex-help">虚线为上期 {previousRange.start} 至 {previousRange.end} 的真实原值，按相对日序对齐；两期等长且同渠道，实际日期见提示及表格。缺失值不跨线连接，差值须通过逐指标可比检查。</p>}
    <p id={`${titleId}-scroll-help`} className="rex-help rex-scroll-help no-print">图内可横向滚动查看完整日期；也可切换表格。聚焦图表后，用左右方向键逐日浏览，选中日期会自动滚动到可见位置。</p>
    <div ref={plot} className={`rex-plot-wrapper ${view === 'table' ? 'rex-plot-hidden' : ''}`} inert={view === 'table'} aria-hidden={view === 'table'} tabIndex={view === 'chart' ? 0 : -1} role="group" aria-describedby={`${titleId}-scroll-help`} aria-label="趋势图。使用 ArrowLeft、ArrowRight（左右方向键）逐日浏览，Home 到首日，End 到末日。" onKeyDown={event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, rows.length - 1) : Math.max(0, Math.min(rows.length - 1, active + (event.key === 'ArrowLeft' ? -1 : 1))); setActive(next); reveal(next); }
    }}>
      <svg ref={svg} viewBox="0 0 960 400" className="rex-trend-svg" role="img" aria-labelledby={titleId} fontFamily="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif" onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); if (rect.width > 0) setActive(Math.max(0, Math.min(rows.length - 1, Math.round(((event.clientX - rect.left) * 960 / rect.width - box.left) / box.width * Math.max(1, rows.length - 1))))); }}>
        <title id={titleId}>{`${task.title}；${valueLabel}；${scopeLabel(range)}。可切换表格读取完整数值。`}</title>
        <rect width="960" height="400" fill="#ffffff" />
        <text x="18" y="26" fill="#233d30" fontSize="18" fontWeight="600">{[...task.title].slice(0, 42).join('')} · {kind === 'activity' ? '玩家活跃趋势' : '支付收入趋势'}</text>
        <text x="18" y="49" fill="#4c5b52" fontSize="12">{range.start} 至 {range.end} · {range.channels.length ? `渠道：${shortChannels}` : '全部渠道'} · 上海自然日</text>
        <text x="18" y="70" fill="#4c5b52" fontSize="12">{kind === 'activity' ? '粗实线：活跃人数；细实线：新增人数' : `实线：当前收入，单位 ${report.currency}`}{previousRange ? `；虚线：上期 ${previousRange.start} 至 ${previousRange.end}` : ''}</text>
        <text x="18" y="91" fill="#59685f" fontSize="11">{explorer.result ? '确定性派生；原件不变。' : '原始报告。'}缺失值保留空缺；时间重合不证明因果。</text>
        {[0, 0.5, 1].map(ratio => { const tick = max * (1 - ratio); return <g key={ratio}><line x1={box.left} x2={box.left + box.width} y1={box.top + box.height * ratio} y2={box.top + box.height * ratio} stroke="#e2e7e4" strokeDasharray="3 4" /><text x={box.left - 12} y={box.top + box.height * ratio + 4} textAnchor="end" fill="#59685f" fontSize="12">{tick >= 100000000 ? `${number(tick / 100000000, 1)}亿` : tick >= 10000 ? `${number(tick / 10000, 1)}万` : number(tick, kind === 'revenue' ? 2 : 0)}</text></g>; })}
        {series.map(line => <g key={line.key}>{linePaths(rows, line.key, box).map((path, index) => <path key={index} d={path} fill="none" stroke={line.color} strokeWidth={line.width} strokeDasharray={line.dash} strokeLinecap="round" strokeLinejoin="round" />)}{rows.map((row, index) => { const value = row[line.key]; if (typeof value !== 'number' || (rows.length > 50 && typeof rows[index - 1]?.[line.key] === 'number' && typeof rows[index + 1]?.[line.key] === 'number')) return null; return <circle key={index} cx={box.left + (rows.length > 1 ? index * box.width / (rows.length - 1) : box.width / 2)} cy={box.top + box.height - value * box.height / max} r={line.dash ? 2 : 2.5} fill={line.dash ? '#ffffff' : line.color} stroke={line.color} strokeWidth="1.4" />; })}</g>)}
        {selected && <line className="rex-active-guide" x1={activeX} x2={activeX} y1={box.top} y2={box.top + box.height} stroke="#cdd6d0" strokeDasharray="2 4" />}
        {[...new Set(annotations.map(note => note.date))].map(date => { const index = rows.findIndex(row => row.date === date); if (index < 0) return null; const x = box.left + (rows.length > 1 ? index * box.width / (rows.length - 1) : box.width / 2); return <g key={date} role="button" tabIndex={0} aria-label={`查看 ${date} 的日期批注`} onClick={() => { setActive(index); reveal(index); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActive(index); reveal(index); } }}><title>{`${date} 有日期批注，仅为背景，不证明因果`}</title><line x1={x} x2={x} y1="109" y2={box.top + box.height} stroke="#a68640" strokeWidth="1" strokeDasharray="1 5" /><rect x={x - 9} y="99" width="18" height="17" rx="3" fill="#fff7df" stroke="#a68640" /><text x={x} y="111" textAnchor="middle" fontSize="11" fill="#73591f">注</text></g>; })}
        <text x={box.left} y="368" fill="#59685f" fontSize="12">{rows[0]?.date || '无日期'}</text><text x={box.left + box.width} y="368" textAnchor="end" fill="#59685f" fontSize="12">{rows.at(-1)?.date}</text>
        <text x="18" y="391" fill="#59685f" fontSize="11">当前期间实际日期；— 为无数据，非零。收入不跨币种合计。DATAAGENT</text>
      </svg>
    </div>
    <div className="rex-day-tooltip" role="status" aria-live="polite" aria-atomic="true">{tooltip}</div>
    {view === 'table' && <div className="rex-daily-screen"><DailyTable rows={rows.slice(currentPage * 31, (currentPage + 1) * 31)} currency={report.currency} previous={!!previousRange} /><div className="rex-pagination no-print"><span>{rows.length} 日 · 第 {currentPage + 1} / {pageCount} 页</span><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页日期</button><button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页日期</button></div></div>}
    <div className="rex-print-only"><DailyTable rows={rows} currency={report.currency} previous={!!previousRange} /></div>
    {explorer.enabled && <OverviewBrush task={task} explorer={explorer} />}
    <div className="rex-export-actions no-print" aria-label="当前视图导出"><span><Download size={14} />导出已应用视图</span><button type="button" onClick={() => csv('metrics')}>指标 CSV</button><button type="button" onClick={() => csv('channels')}>渠道 CSV</button><button type="button" onClick={() => csv('retention')}>留存 CSV</button><button type="button" onClick={() => csv('daily')}>每日 CSV</button><button type="button" disabled={exporting || !rows.length} aria-busy={exporting} onClick={() => void png()}>{exporting ? '生成 PNG…' : '趋势 PNG'}</button><button type="button" onClick={() => window.print()}><FileText size={13} />打印 / PDF</button></div>
    {exportError && <p className="rex-error" role="alert">{exportError}</p>}
    <p className="rex-help">导出内容对应当前已应用范围，草稿不影响导出。CSV 保留无数据空值，包含完整精度及范围说明；批注不写入统计 CSV。PNG 仅使用本机图形与中文系统字体，打印包含完整每日表格。</p>
    <Annotations key={`${task.id}:${task.report?.generatedAt || ''}`} task={task} explorer={explorer} selectedDate={selected?.date} onChange={(key, list) => setAnnotationState({ key, list })} />
  </section>;
}

function DailyTable({ rows, currency, previous }: { rows: TrendRow[]; currency: string; previous: boolean }) {
  return <div className="rex-table-scroll"><table className="data-table rex-daily-table"><caption>已应用范围每日数据 · — 表示无数据、覆盖不足或原任务跳过</caption><thead><tr><th>当前日期</th><th>活跃</th><th>新增</th><th>收入（{currency}）</th><th>付费人数</th>{previous && <><th>上期实际日期</th><th>上期活跃</th><th>上期新增</th><th>上期收入（{currency}）</th><th>上期付费人数</th></>}</tr></thead><tbody>{rows.map(row => <tr key={row.date}><th scope="row">{row.date}</th><td>{number(row.dau)}</td><td>{number(row.newUsers)}</td><td>{number(row.revenue, 2)}</td><td>{number(row.payers)}</td>{previous && <><td>{row.previousDate || '—'}</td><td>{number(row.previousDau)}</td><td>{number(row.previousNewUsers)}</td><td>{number(row.previousRevenue, 2)}</td><td>{number(row.previousPayers)}</td></>}</tr>)}</tbody></table>{!rows.length && <p className="rex-help">所选范围暂无每日数据，请检查源数据覆盖。</p>}</div>;
}
function OverviewBrush({ task, explorer }: ExplorerProps) {
  const daily = task.report?.daily || [];
  const indices = brushIndices(explorer.dates, explorer.draft), max = Math.max(1, ...daily.map(day => day.dau || 0));
  const rows = trendRows({ daily }), box = { left: 0, top: 4, width: 900, height: 34, max };
  return <div className="rex-brush no-print"><div className="rex-brush-heading"><strong>原报告全期间概览</strong><small>{explorer.originalRange.start} 至 {explorer.originalRange.end}</small></div>
    <svg viewBox="0 0 900 44" role="img" aria-label="原报告完整期间活跃概览，仅用于定位筛选范围"><rect width="900" height="44" fill="#f2f6f0" /><rect x={indices.startIndex / Math.max(1, explorer.dates.length - 1) * 900} width={Math.max(4, (indices.endIndex - indices.startIndex) / Math.max(1, explorer.dates.length - 1) * 900)} height="44" fill="#dce9dc" />{linePaths(rows, 'dau', box).map((path, index) => <path key={index} d={path} fill="none" stroke="#557761" strokeWidth="1.5" />)}</svg>
    <div className="rex-brush-handles"><label>范围起点：{explorer.dates[indices.startIndex] || '—'}<input type="range" aria-label="范围起点（原报告概览）" aria-valuetext={explorer.dates[indices.startIndex]} min="0" max={Math.max(0, explorer.dates.length - 1)} step="1" value={indices.startIndex} disabled={!explorer.dates.length} onChange={event => explorer.setRangeFromBrush(Number(event.target.value), indices.endIndex)} /></label><label>范围终点：{explorer.dates[indices.endIndex] || '—'}<input type="range" aria-label="范围终点（原报告概览）" aria-valuetext={explorer.dates[indices.endIndex]} min="0" max={Math.max(0, explorer.dates.length - 1)} step="1" value={indices.endIndex} disabled={!explorer.dates.length} onChange={event => explorer.setRangeFromBrush(indices.startIndex, Number(event.target.value))} /></label></div>
    <p className="rex-help">拖动范围端点后自动精确重算，连续拖动会合并请求。概览始终来自原报告；上方数据在新结果到达前保持原已应用范围。日期输入可选择概览之外的完整自然日，覆盖限制以服务端返回为准。</p>
  </div>;
}

function Annotations({ task, explorer, selectedDate, onChange }: ExplorerProps & { selectedDate?: string; onChange: (key: string, list: ReportAnnotation[]) => void }) {
  const { runtime, user } = useAuth(); const key = annotationStorageKey(runtime.mode, user?.id, window.location.origin, task.id);
  function storage() { try { return localStorage; } catch { return undefined; } }
  function read(storageChanged = false) { return readAnnotationState(storage(), key, storageChanged); }
  const [stored, setStored] = useState(() => ({ key, ...read() })); const [error, setError] = useState('');
  const [date, setDate] = useState(selectedDate || explorer.originalRange.start); const [type, setType] = useState<AnnotationType>('event'); const [text, setText] = useState('');
  const list = stored.key === key ? stored.list : [];
  const blocked = stored.key === key && stored.blocked;
  useEffect(() => { onChange(key, list); }, [key, stored]);
  useEffect(() => {
    setStored({ key, ...read() }); setError(''); setText(''); setDate(selectedDate || explorer.originalRange.start);
    const changed = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      if (event.newValue === null) readAnnotationState({ getItem: () => null }, key, true);
      setStored({ key, ...read(true) });
    };
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
    // Keep account/service boundaries isolated; do not reset edits on chart hover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  function save(next: ReportAnnotation[]) {
    const ok = saveAnnotations(storage(), key, next);
    setStored({ key, list: next, blocked: !ok });
  }
  const range = explorer.appliedScope || explorer.originalRange;
  const visible = list.filter(entry => entry.date >= range.start && entry.date <= range.end);
  return <details className="rex-annotations"><summary>日期批注 <span>{visible.length} 条在当前范围 · 本任务共 {list.length} / 100 条</span></summary>
    <p className="rex-help">仅保存在此设备的当前服务、账号与任务中。批注不参与计算，不自动发送给模型；可由你参考作解读背景。时间重合不证明因果。</p>
    {blocked && <p className="rex-error" role="status">浏览器未允许持久保存，批注暂存于本窗口，切换页面仍可恢复；关闭、刷新或访问超过 50 份报告后可能丢失。</p>}
    <form className="rex-annotation-form no-print" onSubmit={event => {
      event.preventDefault(); const value = text.trim();
      if (!isCalendarDate(date)) { setError('请选择有效日期。'); return; }
      if (!value || [...value].length > 300) { setError('批注需为 1–300 个字。'); return; }
      if (list.length >= 100) { setError('本任务最多 100 条批注，请先删除旧批注。'); return; }
      save([...list, { id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, date, type, text: value }]); setText(''); setError('');
    }}>
      <label>批注日期<input type="date" required min="1000-01-01" max={explorer.cutoff} value={date} onChange={event => setDate(event.target.value)} />{selectedDate && <button type="button" className="rex-use-date" onClick={() => setDate(selectedDate)}>使用图中日期 {selectedDate}</button>}</label>
      <label>背景类型<select value={type} onChange={event => setType(event.target.value as AnnotationType)}>{Object.entries(annotationTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="rex-note-text">背景记录<textarea value={text} required maxLength={600} placeholder="例如：当日版本发布。请只记录已知事实。" onChange={event => setText(event.target.value)} /><small>{[...text].length} / 300 字</small></label><button type="submit" className="button secondary">保存批注</button>
    </form>
    {error && <p className="rex-error" role="alert">{error}</p>}
    <ul className="rex-annotation-list">{list.map(entry => <li key={entry.id} className={entry.date < range.start || entry.date > range.end ? 'rex-note-outside' : ''}><div><strong>{entry.date} · {annotationTypeLabels[entry.type]}</strong>{(entry.date < range.start || entry.date > range.end) && <small>当前范围外</small>}<p>{entry.text}</p></div><button type="button" className="no-print" aria-label={`删除 ${entry.date} 的${annotationTypeLabels[entry.type]}批注`} onClick={() => save(list.filter(item => item.id !== entry.id))}><Trash2 size={14} /><span>删除</span></button></li>)}</ul>
    {!list.length && <p className="rex-help">尚无批注。可记录版本、活动或其他已知背景，辅助阅读当前趋势。</p>}
  </details>;
}
