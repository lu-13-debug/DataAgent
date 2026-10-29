import { ArrowRight, GitBranch } from 'lucide-react';
import type { Task } from '../types';
import { useAuth } from '../auth-context';
export function ReportLineage({ task, tasks, onSelect, onContinue }: { task: Task; tasks: Task[]; onSelect: (task: Task) => void; onContinue: () => void }) {
  const { runtime } = useAuth(); const chain: { id: string; task?: Task }[] = []; const seen = new Set([task.id]); let id = task.sourceTaskId;
  while (id && !seen.has(id) && chain.length < 12) { seen.add(id); const source = tasks.find(item => item.id === id); chain.push({ id, task: source }); id = source?.sourceTaskId; }
  chain.reverse();
  return <section className="report-lineage no-print" aria-label="报告来源与继续分析"><div>{chain.length > 0 && <><strong><GitBranch size={15} />来源分析链路</strong><ol>{chain.map((source, index) => <li key={source.id}>{index > 0 && <ArrowRight size={12} />}{source.task ? <button className="text-button" onClick={() => onSelect(source.task!)}>{source.task.title}</button> : <span>来源 {source.id}（当前记录不可用）</span>}</li>)}</ol></>}</div><button className="button secondary" onClick={onContinue}>{runtime.capabilities?.reportContinuation === true ? "基于此继续 · 新任务 20 额度" : "新建相似分析 · 20 额度"}<ArrowRight size={14} /></button></section>;
}
