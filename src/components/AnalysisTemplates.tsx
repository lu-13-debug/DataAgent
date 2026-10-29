import { ArrowRight, BookOpen } from 'lucide-react';
import { analysisTemplates, templateAvailability, templateGoal } from '../analysis-templates';
import type { Dataset } from '../types';
export function AnalysisTemplates({ datasets, onSelect }: { datasets: Dataset[]; onSelect: (goal: string, datasetId: string) => void }) {
  return <details className="analysis-templates card no-print"><summary><BookOpen size={17} />从分析模板开始<span>留存、渠道、付费、版本、活动</span></summary><p>模板只预填问题和数据，仍需核对范围并确认开始；不会跳过协作确认。</p><div className="analysis-template-grid">{analysisTemplates.map(template => {
    const availability = templateAvailability(template, datasets); const selected = datasets.find(dataset => dataset.id === availability.dataset?.id);
    return <article className="analysis-template" key={template.id}><h3>{template.title}</h3><span className="tiny-tag">需要 {template.tables.join(' / ')}</span><p>{template.question}</p><p><strong>产出：</strong>{template.output}</p>{template.context && <p className="template-context">{template.context}</p>}<div>{selected ? <small>将预填：{selected.name}</small> : <p className="template-missing">{availability.missing.length ? `缺少 ${availability.missing.join(' / ')}，请先上传相应数据表。` : '现有数据不可分析，请先修复质量问题。'}</p>}<button className="button secondary" disabled={!selected} onClick={() => { if (selected) onSelect(templateGoal(template, selected), selected.id); }}>使用模板<ArrowRight size={13} /></button></div></article>;
  })}</div></details>;
}
