import { useState } from 'react';
import { Copy, Info } from 'lucide-react';
import type { DataIssue, Dataset } from '../types';
import { datasetSummary, missingTableImpacts, tableLabels, metricLabel } from '../data-inspection';
import { number } from './ui';

export function QualityIssues({ issues }: { issues: DataIssue[] }) {
  const [copyStatus, setCopyStatus] = useState(''); const [manual, setManual] = useState('');
  async function copy(issue: DataIssue) {
    const text = `问题：${issue.problem}\n影响指标：${issue.metrics.map(metricLabel).join('、') || '数据可用性'}\n建议修复：${issue.fix}\n定位：${issue.location?.table || '数据集'} / ${issue.location?.column || '未记录列'} / ${issue.location?.rows?.length ? '源文件第 ' + issue.location.rows.join('、') + ' 行' : '未记录行号'}`;
    try { await navigator.clipboard.writeText(text); setCopyStatus('问题与修复建议已复制'); setManual(''); }
    catch { setManual(text); setCopyStatus('自动复制不可用，请选择以下文本复制'); }
  }
  return <section className="quality-issues" aria-label="可行动的数据质量提示"><h3>数据质量与修复建议</h3>{issues.length ? issues.map((issue, index) => <article className={`quality-issue issue-${issue.severity}`} key={`${issue.code}-${index}`}><div className="inspection-heading"><strong>{issue.problem}</strong><button className="text-button" onClick={() => void copy(issue)}><Copy size={13} />复制问题</button></div><dl><div><dt>影响指标</dt><dd>{issue.metrics.map(metricLabel).join('、') || '数据可用性'}</dd></div><div><dt>建议修复</dt><dd>{issue.fix}</dd></div><div><dt>定位</dt><dd>{issue.location?.table || '数据集'}{issue.location?.column ? ` / ${issue.location.column}` : ''}{issue.location?.rows?.length ? ` / 源文件第 ${issue.location.rows.join('、')} 行` : ' / 未记录具体行号'}</dd></div></dl></article>) : <p>当前没有已记录的结构化质量问题。</p>}<span className="sr-only" role="status">{copyStatus}</span>{manual && <label className="field">手动复制问题<textarea readOnly value={manual} onFocus={event => event.currentTarget.select()} rows={5} /></label>}</section>;
}
export function DatasetInspection({ dataset, showMappings = true }: { dataset: Dataset; showMappings?: boolean }) {
  const summary = datasetSummary(dataset); const metadata = dataset.inspection;
  const impacts = missingTableImpacts(dataset.tables.map(table => table.type));
  return <div className="dataset-inspection">
    <div className="coverage-summary"><div><span>数据时间范围</span><strong>{dataset.dateRange?.start?.slice(0, 10) || '未记录'} 至 {dataset.dateRange?.end?.slice(0, 10) || '未记录'}</strong></div><div><span>原始 / 有效行数</span><strong>{number(summary.rawRows)} / {summary.validRows == null ? '未记录' : number(summary.validRows)}</strong></div><div><span>全量规则质量分</span><strong>{summary.score == null ? '未记录' : `${summary.score} / 100`}</strong></div></div>
    <p className="field-help">时区 Asia/Shanghai；实际指标只使用完整自然日。原始行数与去重后的有效行数可能不同。</p>
    {metadata?.coverage.length ? <details className="inspection-details"><summary>查看各表覆盖范围与评分规则</summary><ul>{metadata.coverage.map((table, index) => <li key={table.table + index}>{tableLabels[table.table] || table.table}：{table.start?.slice(0, 10) || '无'} 至 {table.end?.slice(0, 10) || '无'} · {number(table.validRows)} 条有效记录</li>)}</ul><p>{metadata.quality.rule}</p></details> : null}
    {impacts.length > 0 && <aside className="data-impact" role="note"><Info size={17} /><div><strong>部分指标不可计算，其他数据分支仍可分析</strong>{impacts.map(impact => <p key={impact}>{impact}</p>)}</div></aside>}
    {!summary.analyzable && <p className="form-error" role="alert">当前数据不可分析，请先按质量提示修复后重新上传。不会创建任务或冻结额度。</p>}
    {showMappings && <section className="mapping-section"><div className="inspection-heading"><h3>字段识别结果</h3><span className="tiny-tag">自动识别 · 只读确认</span></div>{metadata?.mappings.length ? <div className="table-scroll"><table className="data-table mapping-table"><thead><tr><th>表 / 来源</th><th>标准字段 ← 源列名</th><th>识别方式</th></tr></thead><tbody>{metadata.mappings.map((mapping, index) => <tr key={index}><td>{mapping.table}<small>{mapping.source}</small></td><td><strong>{mapping.field}</strong> ← {mapping.sourceColumn ?? '源文件未提供'}</td><td>{mapping.origin === 'generated' ? '系统生成' : '自动识别'}{mapping.required ? ' · 必填' : ' · 可选'}</td></tr>)}</tbody></table></div> : <p className="legacy-metadata">历史数据未保存源列映射，不能反推识别结果。重新上传后可查看真实映射。</p>}</section>}
    {metadata ? <QualityIssues issues={metadata.issues} /> : <><p className="legacy-metadata">历史数据未记录全量质量分与问题定位。以下仅展示已有提示。</p>{dataset.warnings.map((warning, index) => <p className="field-help" key={index}>{warning}</p>)}</>}
  </div>;
}
