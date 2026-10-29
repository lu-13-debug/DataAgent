import { useCallback, useState } from 'react';
import { parseReportTags } from '../report-assets';
import type { Task } from '../types';
import { Modal, Spinner } from './ui';
export function ReportTagsModal({ task, tags, close, save }: { task: Task; tags: string[]; close: () => void; save: (tags: string[]) => Promise<void> }) {
  const [value, setValue] = useState(tags.join('，')); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const parsed = parseReportTags(value);
  const dismiss = useCallback(() => close(), [close]);
  async function submit() { if (busy || parsed.error) return; setBusy(true); setError(''); try { await save(parsed.tags); close(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }
  return <Modal title="整理报告标签" subtitle={task.title} close={dismiss} dismissible={!busy}><div className="modal-body"><label className="field">标签<textarea aria-label="报告标签" value={value} maxLength={400} rows={3} onChange={event => setValue(event.target.value)} placeholder="例如：留存，版本复盘，待验证" /><small className="field-help">使用逗号或换行分隔；最多 8 个标签，每个最多 20 个字。留空可清除。</small></label><div className="report-tags">{parsed.tags.map(tag => <span key={tag}>{tag}</span>)}</div>{(parsed.error || error) && <p className="form-error" role="alert">{parsed.error || error}</p>}</div><div className="modal-footer"><button className="button secondary" disabled={busy} onClick={close}>返回列表</button><button className="button primary" disabled={busy || Boolean(parsed.error)} onClick={() => void submit()}>{busy && <Spinner size={14} />}保存标签</button></div></Modal>;
}
