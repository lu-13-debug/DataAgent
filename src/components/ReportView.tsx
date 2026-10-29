import { useState } from 'react';
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, CircleCheck, CircleHelp, Coins, Download, FileCheck2, FileText, Lightbulb, MoreHorizontal, ShieldCheck, Sparkles, Target, TrendingUp, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Dataset, ExploreScope, Report, Task } from '../types';
import { date, number, Status } from './ui';
import { useAuth } from '../auth-context';
import { ReportDownload } from './ReportDownload';
import { workspaceMessage } from '../product-state';
import { isPresetSample } from '../onboarding';
import { ModelUsage } from './ModelUsage';
import { ReportLineage } from './ReportLineage';
import { MetricCards } from './MetricCards';
import { MetricGlossary } from './MetricGlossary';
import { EvidenceText } from './EvidenceText';
import { ReportChannelsTable } from './ReportChannelsTable';
import { ReportExplorer, ExplorerChart } from './ReportExplorer';
import { useReportExplorer } from '../use-report-explorer';
import '../report-details.css';
import { ShareManager } from './ShareManager';

export function Workspace({ task, dataset, onNew, onShowData, full, setFull, onSampleGuide, tasks, onContinue, onSelectSource }: { onSampleGuide: () => void; task?: Task; dataset?: Dataset; onNew: (goal?: string) => void; onShowData: (data: Dataset) => void; full: boolean; setFull: (v: boolean) => void; tasks: Task[]; onContinue: (task: Task) => void; onSelectSource: (task: Task) => void }) {
  const { runtime } = useAuth();
  const cloud = runtime.mode === 'cloud';
  const [goal, setGoal] = useState('');
  const [sharing, setSharing] = useState(false);
  const explorer = useReportExplorer(task, runtime.capabilities?.reportExplore === true);
  const report = explorer.displayReport;
  const placeholder = workspaceMessage(task);
  const sampleReport = Boolean(report && (dataset?.source === 'demo' || (task && isPresetSample(task))));
  return <>
    <div className="page-heading"><div><div className="eyebrow">A LITTLE CLARITY. A BETTER NEXT MOVE.</div><h1>让数据，指引下一步<span className="heading-period">.</span></h1><p>从玩家行为到业务洞察，和 AI 一起找到增长的线索。</p></div><span className="page-heading-decoration"><TrendingUp size={48} strokeWidth={1} /></span></div>
    <div className="explore-box"><div className="explore-top"><span className="sparkle-box"><Sparkles size={18} /></span><span>今天，想从数据中了解什么？</span><span className="explore-tag">你的分析搭档</span></div><form onSubmit={e => { e.preventDefault(); onNew(goal); }}><input aria-label="分析目标" value={goal} onChange={e => setGoal(e.target.value)} placeholder="例如：最近玩家留存下降，哪些渠道值得关注？" /><button className="explore-submit" aria-label="创建分析" type="submit"><ArrowRight size={18} /></button></form><div className="quick-prompts">{[{ icon: Users, text: '看看玩家留存', goal: '分析最近的玩家留存，比较不同渠道的新玩家表现，找出需要关注的群体。' }, { icon: Coins, text: '分析付费表现', goal: '分析游戏付费表现，观察收入、付费人数和ARPPU的变化，并提出运营建议。' }, { icon: Target, text: '比较渠道质量', goal: '比较不同获客渠道的新增、留存和收入贡献，关注样本量和观察期。' }].map(p => <button key={p.text} onClick={() => onNew(p.goal)}><p.icon size={12} />{p.text}<ArrowUpRight size={11} /></button>)}</div></div>
    <div className="section-heading overview-heading"><div><h2>运营概览</h2><span className="subtle-label">{report?.period || (task ? '等待分析结果' : '尚未开始分析')}</span></div>{dataset && <button className="source-pill" onClick={() => onShowData(dataset)}><span className="online-dot" />{dataset.source === 'demo' ? '示例数据' : dataset.name}<ChevronDown size={12} /></button>}</div>
    {!report ? <div className="analysis-placeholder"><span className="sparkle-box"><Activity size={23} /></span><h3>{placeholder.title}</h3><p>{placeholder.detail}</p>{!['running', 'waiting'].includes(placeholder.kind) && <button className="button primary" onClick={() => onNew()}>新建分析<ArrowRight size={14} /></button>}<div className="placeholder-steps">{task?.steps.map(s => <div key={s.id} className={`placeholder-step ${s.status}`}><span />{s.name}</div>)}</div></div> : <>
    {sampleReport && <section className="sample-report-banner" role="note" tabIndex={-1}><div><strong>示例数据，不代表真实业务；阅读本报告不扣额度。</strong><p>用这份报告了解指标、数据依据和建议。新建真实分析仍需 20 额度。</p></div><button className="button secondary no-print" onClick={onSampleGuide}>用这份数据了解协作流程<ArrowRight size={14} /></button><span className="readonly-label no-print">只读说明</span></section>}
      {cloud && runtime.capabilities?.reportSharing === true && task?.status === 'completed' && task.report && <div className="no-print share-entry"><button className="button secondary" onClick={() => setSharing(true)}>分享原始完整报告</button><span>不包含当前筛选</span></div>}
      {sharing && task && <ShareManager key={`${task.id}:${task.report?.generatedAt || ""}:${task.report?.period || ""}`} taskId={task.id} period={task.report?.period} close={() => setSharing(false)} />}
      <ReportLineage task={task!} tasks={tasks} onSelect={onSelectSource} onContinue={() => onContinue(task!)} />
      <ReportExplorer task={task!} explorer={explorer} />
      <MetricCards report={report} result={explorer.result} />
      <MetricGlossary report={report} />
      <div className="report-nav"><div className="tabs" role="tablist" aria-label="报告视图"><button role="tab" aria-selected={!full} className={!full ? 'selected' : ''} onClick={() => setFull(false)}>分析概览</button><button role="tab" aria-selected={full} className={full ? 'selected' : ''} onClick={() => setFull(true)}>完整报告</button></div><span className="verified-label"><ShieldCheck size={13} />计算结果可追溯</span></div>
      {full ? <FullReport report={report} task={task!} chart={<ExplorerChart task={task!} explorer={explorer} />} scope={explorer.appliedScope} originalUsageReport={task!.report} /> : <><ExplorerChart task={task!} explorer={explorer} /><div className="insights-grid"><Findings report={report} /><Retention report={report} /></div><div className="report-ready"><div className="ready-icon"><FileCheck2 size={22} /></div><div><strong>更多发现，已整理成一份报告</strong><p>包含完整指标、数据口径，以及下一步的行动建议。</p></div><button className="text-button" onClick={() => setFull(true)}>阅读完整报告 <ArrowRight size={14} /></button></div></>}
    </>}
    <footer className="workspace-footer"><span><ShieldCheck size={12} />{cloud ? '数据与报告按账号保存在服务器，模型仅接收业务背景与聚合指标' : '数据保存在本机，模型仅接收聚合指标'}</span><span>有依据的分析 · 有方向的决策</span></footer>
  </>;
}
function Findings({ report }: { report: Report }) {
  return <section className="card findings-card"><div className="card-heading"><h3><Sparkles size={16} className="accent-icon" />值得关注的发现</h3><span className="subtle-label">{report.findings.length} 条洞察</span></div><div className="findings-list">{report.findings.slice(0, 3).map((f, index) => <div className="finding" key={index}><span className={`finding-icon ${f.severity}`}>{f.severity === 'warning' ? <Lightbulb size={15} /> : f.severity === 'positive' ? <TrendingUp size={15} /> : <Target size={15} />}</span><div><h4>{f.title}</h4><p>{f.detail}</p><span className="evidence"><span /><EvidenceText key={f.evidence} text={f.evidence} /></span></div></div>)}</div></section>;
}
function Retention({ report }: { report: Report }) {
  const matureRows = report.retention.filter(r => r.d7 != null);
  const rows = (matureRows.length ? matureRows : report.retention.filter(r => r.d1 != null)).slice(-5);
  function cell(value: number | null) { return <td><span className={`retention-cell ${value == null ? 'immature' : ''}`} style={value == null ? undefined : { background: `rgba(54,124,91,${0.06 + Math.min(1, value / 100) * 0.35})`, color: '#32614d' }}>{value == null ? '未成熟' : `${value.toFixed(1)}%`}</span></td>; }
  return <section className="card retention-card"><div className="card-heading"><h3>新玩家留存</h3><span title="按注册日期分组，仅统计观察期完整的玩家" className="subtle-label"><CircleHelp size={14} /></span></div><p className="card-description">按注册日期分组，优先展示观察期完整的群体。</p><div className="retention-table-wrapper"><table className="retention-table"><thead><tr><th>注册日期</th><th>新玩家</th><th>次日</th><th>第 7 日</th></tr></thead><tbody>{rows.map(r => <tr key={r.date}><td>{r.date.slice(5).replace('-', '/')}</td><td>{number(r.users)}</td>{cell(r.d1)}{cell(r.d7)}</tr>)}</tbody></table>{!rows.length && <p className="inline-empty">缺少注册数据或完整观察期</p>}</div><div className="retention-legend"><span>低</span><i /><i /><i /><i /><span>高</span><small>未成熟群体不计入汇总</small></div></section>;
}
function FullReport({ report, task, chart, scope, originalUsageReport }: { report: Report; task: Task; chart: ReactNode; scope?: ExploreScope; originalUsageReport?: Report }) {
  return <article className="card full-report"><div className="full-report-heading"><div className="report-file-icon"><FileText size={25} /></div><div><div className="eyebrow">GAME OPERATIONS REPORT</div><h2>{task.title}</h2><p>{report.period} · {report.source === 'ai' ? 'AI 辅助解读' : '确定性分析引擎'}</p></div><div className="report-actions no-print"><ReportDownload id={task.id} name={task.title} className="button secondary" label="下载原始 Markdown 报告"><Download size={15} />原始 Markdown</ReportDownload><button className="button primary" onClick={() => window.print()}><FileText size={15} />打印 / PDF</button></div></div><div className="report-section"><h3><Sparkles size={17} />运营摘要</h3><p className="report-summary">{report.summary}</p></div><div className="report-section"><h3>关键指标</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>指标</th><th>数值</th><th>统计口径</th></tr></thead><tbody>{report.metrics.map(m => <tr key={m.id}><td>{m.label}</td><td className="table-number">{number(m.value, m.unit.includes('%') || ['revenue', 'arppu', 'arpdau'].includes(m.id) ? 2 : 0)} {m.value == null ? '' : m.unit}</td><td>{m.note}</td></tr>)}</tbody></table></div></div><div className="report-section"><h3>玩家与收入趋势</h3>{chart}</div><div className="report-section"><h3>渠道表现</h3><ReportChannelsTable key={`${task.id}:${report.period}:${(scope?.channels || []).join("|")}`} report={report} task={task} scope={scope} /></div><div className="report-section"><h3>主要发现</h3>{report.findings.map((f, i) => <div key={i} className="report-finding"><h4><span>{String(i + 1).padStart(2, '0')}</span>{f.title}</h4><p>{f.detail}</p><small>数据依据：<EvidenceText key={f.evidence} text={f.evidence} /></small></div>)}</div><div className="report-section"><h3><Target size={17} />下一步行动</h3><ol className="recommendations">{report.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ol></div><div className="report-section"><h3><ShieldCheck size={17} />数据质量与方法</h3><div className="quality-banner"><CircleCheck size={18} /><span>{scope ? '源记录共' : '本次处理'} {number(report.quality.rows)} 条记录</span><strong>质量评分 {report.quality.score}/100</strong></div>{report.quality.issues.length > 0 && <ul className="methodology">{report.quality.issues.map((v, i) => <li key={i}>{v}</li>)}</ul>}<ul className="methodology">{report.methodology.map((v, i) => <li key={i}>{v}</li>)}</ul></div>{scope && <p className="original-usage-note">模型用量来自原始报告；当前筛选是免费确定性计算，不产生额外模型用量。</p>}<ModelUsage report={originalUsageReport || report} /><div className="report-signature"><span>DATAAGENT</span><span>从数据出发，为决策而来。</span></div></article>;
}
