import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { downloadText, Spinner } from './ui';

export function ReportDownload({ id, name, children, className, label, onDone, onError }: { id: string; name: string; children: ReactNode; className?: string; label?: string; onDone?: () => void; onError?: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    if (busy) return;
    setBusy(true); setError('');
    try { const markdown = await api.report(id); downloadText(`${name.replace(/[<>:"/\\|?*]/g, '_')}.md`, markdown, 'text/markdown;charset=utf-8'); onDone?.(); }
    catch (cause) { const message = (cause as Error).message; setError(message); onError?.(message); }
    finally { setBusy(false); }
  }
  return <><button type="button" className={className} aria-label={label || '下载 Markdown 报告'} aria-busy={busy} disabled={busy} onClick={() => void download()}>{busy ? <Spinner size={15} /> : children}</button>{error && !onError && <span className="report-download-error" role="alert">{error}</span>}</>;
}
