import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Check, CheckCircle2, LoaderCircle, X } from 'lucide-react';
import type { TaskStatus } from '../types';

export function Logo({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true"><i /><i /><i /><i /></span>;
}
export function Modal({ title, subtitle, children, close, wide = false }: { title: string; subtitle?: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = ref.current;
    const items = () => [...(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || [])];
    items()[0]?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const focusable = items(); const first = focusable[0]; const last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = bodyOverflow; document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [close]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
    <div ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={close} aria-label="关闭弹窗"><X size={19} /></button></div>
      {children}
    </div>
  </div>;
}
const statusNames: Record<TaskStatus, string> = { running: '分析中', awaiting_approval: '等待确认', completed: '已完成', failed: '分析失败', cancelled: '已取消' };
export function Status({ value }: { value: TaskStatus }) { return <span className={`status-chip status-${value}`}><span />{statusNames[value]}</span>; }
export function Spinner({ size = 16 }: { size?: number }) { return <LoaderCircle className="spin" size={size} aria-label="处理中" />; }
export function Empty({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Toast({ message, error = false, close }: { message: string; error?: boolean; close: () => void }) {
  return <div className={`toast ${error ? 'toast-error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <X size={17} /> : <CheckCircle2 size={17} />}<span>{message}</span><button onClick={close} aria-label="关闭提示"><X size={15} /></button></div>;
}
export function Checked({ value }: { value: boolean }) { return <span className={`custom-check ${value ? 'checked' : ''}`}>{value && <Check size={12} />}</span>; }
export const number = (value: number | null | undefined, digits = 0) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
export const date = (value: string) => value ? new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }) : '—';
export const dateTime = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
export function downloadText(name: string, text: string) { const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
