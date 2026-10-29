import { useCallback, useState } from 'react';
import { ArrowRight, Columns2, Download, FileChartColumnIncreasing, FileText, Pin, Plus, Search, Star, Tags, X } from 'lucide-react';
import type { ReportFilters } from '../report-assets';
import { emptyReportMetadata, filterReports, reportDateInfo } from '../report-assets';
import type { Task } from '../types';
import { useAuth } from '../auth-context';
import type { ReportMetadataController } from '../use-report-metadata';
import { ReportComparison } from './ReportComparison';
import { ReportTagsModal } from './ReportTagsModal';
import { ReportDownload } from './ReportDownload';
import { dateTime, Empty, Status } from './ui';

export function ReportsPage({ tasks, onSelect, onNew, onContinue, metadata, notify }: { tasks: Task[]; onSelect: (task: Task) => void; onNew: () => void; onContinue: (task: Task) => void; metadata: ReportMetadataController; notify: (message: string, error?: boolean) => void }) {
  const { runtime } = useAuth();
  const [filters, setFilters] = useState<ReportFilters>({}); const [selectedIds, setSelectedIds] = useState<string[]>([]); const [comparing, setComparing] = useState(false); const [tagsTaskId, setTagsTaskId] = useState<string | null>(null);
  const closeTags = useCallback(() => setTagsTaskId(null), []); const closeComparison = useCallback(() => setComparing(false), []);
  const metaById = Object.fromEntries(tasks.map(task => [task.id, metadata.get(task)]));
  const filtered = filterReports(tasks, filters, metaById); const selected = selectedIds.map(id => tasks.find(task => task.id === id)).filter((task): task is Task => Boolean(task));
  const tagsTask = tasks.find(task => task.id === tagsTaskId);
  const dataSources = [...new Map(tasks.map(task => [task.datasetId, task.datasetName])).entries()];
  const allTags = [...new Set(Object.values(metaById).flatMap(item => item.tags))].sort((a, b) => a.localeCompare(b));
  const hasFilter = Object.values(filters).some(value => Boolean(value) && value !== 'all');
  const invalidDates = Boolean(filters.start && filters.end && filters.start > filters.end);
  const updateFilter = (patch: Partial<ReportFilters>) => setFilters(current => ({ ...current, ...patch }));
  async function change(task: Task, patch: Parameters<typeof metadata.save>[1]) { try { await metadata.save(task, patch); } catch (error) { notify((error as Error).message, true); } }
  function toggle(task: Task) { setSelectedIds(current => current.includes(task.id) ? current.filter(id => id !== task.id) : current.length < 2 ? [...current, task.id] : current); }
  return <>
    <div className="page-heading"><div><div className="eyebrow">INSIGHTS WORTH KEEPING</div><h1>分析报告<span className="heading-period">.</span></h1><p>整理分析成果，核对差异，再继续提出问题。</p></div><button className="button primary" onClick={onNew}><Plus size={15} />新建分析</button></div>
    <section className="card report-filters" aria-label="筛选分析报告">
      <div className="report-filter-row"><label className="search-field"><Search size={15} /><input aria-label="搜索分析报告" placeholder="搜索报告、数据源或标签" value={filters.query || ''} onChange={event => updateFilter({ query: event.target.value })} /></label>
        <label className="report-select">数据源<select aria-label="按数据源筛选报告" value={filters.datasetId || ''} onChange={event => updateFilter({ datasetId: event.target.value })}><option value="">全部数据源</option>{dataSources.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="report-select">状态<select aria-label="按状态筛选报告" value={filters.status || 'all'} onChange={event => updateFilter({ status: event.target.value as ReportFilters['status'] })}><option value="all">全部状态</option><option value="completed">已完成</option><option value="active">进行中或待确认</option><option value="failed">分析失败</option><option value="cancelled">已取消</option></select></label>
      </div>
      <details className="report-advanced-filters"><summary>日期、收藏和标签</summary><p className="field-help">已完成报告按生成时间，其他分析按创建时间；均使用上海时区。</p><div className="report-filter-row"><label className="report-select">报告起日（上海）<input type="date" aria-label="报告日期起日" value={filters.start || ''} onChange={event => updateFilter({ start: event.target.value })} /></label><label className="report-select">报告止日（上海）<input type="date" aria-label="报告日期止日" value={filters.end || ''} onChange={event => updateFilter({ end: event.target.value })} /></label><label className="report-select">标签<select aria-label="按标签筛选报告" value={filters.tag || ''} onChange={event => updateFilter({ tag: event.target.value })}><option value="">全部标签</option>{allTags.map(tag => <option key={tag}>{tag}</option>)}</select></label><label className="report-check"><input type="checkbox" checked={Boolean(filters.favoriteOnly)} onChange={event => updateFilter({ favoriteOnly: event.target.checked })} />只看收藏</label></div></details>
      <div className="report-filter-summary"><span role="status">{invalidDates ? '开始日期晚于结束日期，请调整。' : `显示 ${filtered.length} / ${tasks.length} 份分析；筛选仅作用于列表`}</span>{hasFilter && <button className="text-button" onClick={() => setFilters({})}>清除筛选<X size={13} /></button>}</div>
    </section>
    <div className="report-asset-note"><span>{metadata.label}</span><span>已完成报告可勾选两份进行对比</span></div>
    {selected.length > 0 && <section className="report-comparison-bar" aria-label="已选择的对比报告"><div>{selected.map((task, index) => <button key={task.id} onClick={() => toggle(task)} aria-label={`移除对比报告${task.title}`}>{index === 0 ? 'A' : 'B'} · {task.title}<X size={13} /></button>)}</div><button className="button secondary" disabled={selected.length !== 2} onClick={() => setComparing(true)}><Columns2 size={15} />对比两份报告（{selected.length}/2）</button></section>}
    <div className="reports-list">{filtered.map(task => {
      const meta = metaById[task.id] || emptyReportMetadata(); const complete = task.status === 'completed' && Boolean(task.report); const busy = metadata.busyIds.has(task.id); const displayedDate = reportDateInfo(task);
      return <article className={`card report-list-card managed-report ${meta.pinned ? 'report-pinned' : ''}`} key={task.id}>
        <div className="report-list-leading"><span className="report-list-icon"><FileChartColumnIncreasing size={25} strokeWidth={1.5} /></span>{complete && <label className="report-compare-check"><input type="checkbox" aria-label={`选择对比${task.title}`} checked={selectedIds.includes(task.id)} disabled={!selectedIds.includes(task.id) && selectedIds.length >= 2} onChange={() => toggle(task)} />对比</label>}</div>
        <div className="report-list-main"><div><button onClick={() => onSelect(task)}>{task.title}</button><Status value={task.status} />{meta.pinned && <span className="pinned-label"><Pin size={12} />已置顶</span>}</div><p>{task.report?.summary || task.goal}</p><div className="report-list-meta"><span>{task.datasetName}</span><span>{task.mode === 'automatic' ? '自动模式' : '协作模式'}</span><span>{displayedDate.value ? `${displayedDate.label} ${dateTime(displayedDate.value)}` : "时间未知"}</span></div><div className="report-tags">{meta.tags.map(tag => <button key={tag} onClick={() => updateFilter({ tag })} aria-label={`筛选标签${tag}`}>{tag}</button>)}</div>
          {complete && <div className="report-management-actions"><button className={meta.favorite ? 'selected' : ''} aria-pressed={meta.favorite} aria-label={`${meta.favorite ? '取消收藏' : '收藏'}${task.title}`} disabled={busy} onClick={() => void change(task, { favorite: !meta.favorite })}><Star size={14} />{meta.favorite ? '已收藏' : '收藏'}</button><button aria-pressed={meta.pinned} aria-label={`${meta.pinned ? '取消置顶' : '置顶'}${task.title}`} disabled={busy} onClick={() => void change(task, { pinned: !meta.pinned })}><Pin size={14} />{meta.pinned ? '取消置顶' : '置顶'}</button><button disabled={busy} onClick={() => setTagsTaskId(task.id)} aria-label={`编辑标签${task.title}`}><Tags size={14} />标签</button><button onClick={() => onContinue(task)}>{runtime.capabilities?.reportContinuation === true ? "基于此继续" : "新建相似分析"}<ArrowRight size={13} /></button></div>}
        </div>
        <div className="report-list-actions">{complete && <ReportDownload id={task.id} name={task.title} className="icon-button" label={`下载${task.title}`}><Download size={17} /></ReportDownload>}<button className="button secondary" onClick={() => onSelect(task)}>{complete ? '查看报告' : '查看进展'}<ArrowRight size={14} /></button></div>
      </article>;
    })}{!filtered.length && <Empty icon={<FileText size={26} />} title="还没有找到报告" description="调整筛选条件，或创建一次新的分析。" action={hasFilter ? <button className="button secondary" onClick={() => setFilters({})}>清除筛选</button> : <button className="button primary" onClick={onNew}>开始分析</button>} />}</div>
    {tagsTask && <ReportTagsModal task={tagsTask} tags={metadata.get(tagsTask).tags} close={closeTags} save={tags => metadata.save(tagsTask, { tags })} />}
    {comparing && selected.length === 2 && <ReportComparison left={selected[0]} right={selected[1]} close={closeComparison} />}
  </>;
}
