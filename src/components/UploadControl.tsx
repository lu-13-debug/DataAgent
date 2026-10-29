import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Plus, UploadCloud } from 'lucide-react';
import type { Dataset } from '../types';
import { useUpload } from '../use-upload';
import { pasteToCsv } from '../data-inspection';
import { QualityIssues } from './DatasetInspection';
import { Spinner } from './ui';

export function UploadControl({ onSuccess, compact = false, onStart, onBusyChange }: { onSuccess: (dataset: Dataset) => void; compact?: boolean; onStart?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null); const [drag, setDrag] = useState(false); const [paste, setPaste] = useState(false); const [text, setText] = useState(''); const [pasteError, setPasteError] = useState('');
  const upload = useUpload(onSuccess);
  useEffect(() => { onBusyChange?.(upload.busy); }, [upload.busy, onBusyChange]);
  function startFiles(files: File[]) { if (!files.length || upload.busy) return; onStart?.(); void upload.start(files); }
  function uploadPaste() {
    setPasteError('');
    try { const csv = pasteToCsv(text); startFiles([new File([csv], '粘贴运营数据.csv', { type: 'text/csv;charset=utf-8' })]); }
    catch (error) { setPasteError((error as Error).message); }
  }
  return <section className={`upload-control ${compact ? 'upload-compact' : 'upload-zone'} ${drag ? 'dragging' : ''}`} aria-label="上传并识别数据" onDragOver={event => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={event => { event.preventDefault(); setDrag(false); if (!upload.busy) startFiles(Array.from(event.dataTransfer.files)); }}>
    {!compact && <><span className="upload-icon"><UploadCloud size={27} /></span><h3>上传数据，先确认识别结果</h3><p>拖入 CSV / Excel，或从 Excel、飞书表格复制表头与数据。</p></>}
    <div className="upload-actions"><button className="button primary" disabled={upload.busy} onClick={() => input.current?.click()}><Plus size={15} />{compact ? '上传数据' : '选择文件'}</button><button className="button secondary" disabled={upload.busy} onClick={() => setPaste(!paste)} aria-expanded={paste}><ClipboardPaste size={15} />粘贴表格</button></div>
    <input ref={input} type="file" accept=".csv,.xlsx" multiple hidden onChange={event => { startFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
    <small className="field-help">最多 3 个文件，总大小不超过 20MB。粘贴内容使用相同识别规则。</small>
    {paste && <div className="paste-table"><label className="field">粘贴表头和数据<textarea onKeyDown={event => { if (event.key === 'Enter') event.stopPropagation(); }} rows={5} value={text} onChange={event => setText(event.target.value)} placeholder={'玩家ID\t注册日期\t渠道\nplayer_001\t2026-10-01\t自然'} disabled={upload.busy} /></label><button className="button secondary" onClick={uploadPaste} disabled={upload.busy || !text.trim()}>识别粘贴内容</button>{pasteError && <p className="form-error" role="alert">{pasteError}</p>}</div>}
    <div className="upload-status" role="status" aria-live="polite">{upload.busy && <><div className="upload-progress"><progress max={100} value={upload.progress ?? undefined} aria-label="文件传输进度" /><span>{upload.status === 'processing' ? '传输完成，服务器正在识别…' : upload.progress == null ? '正在传输…' : `正在传输 ${upload.progress}%`}</span></div><button className="text-button" onClick={upload.cancel}>取消上传</button></>}{upload.status === 'success' && '数据已导入，请确认识别结果。'}{upload.status === 'cancelled' && '上传已取消；若服务端已完成识别，请刷新后核对数据列表。'}</div>
    {upload.error && <p className="form-error" role="alert">{upload.error}</p>}{upload.issues.length > 0 && <QualityIssues issues={upload.issues} />}
    {upload.busy && <span className="sr-only"><Spinner />上传或识别中</span>}
  </section>;
}
