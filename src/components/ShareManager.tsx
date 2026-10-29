import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ShareItem } from '../types';
import { Modal } from './ui';
import { copyShareLink } from '../share-copy';
import { createManagedShare, revokeManagedShare, createShareListController } from '../share-flow';

export function ShareManager({ taskId, period, close }: { taskId: string; period?: string; close: () => void }) {
  const [items, setItems] = useState<ShareItem[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const [hideRevenue, setHideRevenue] = useState(true);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revoke, setRevoke] = useState<string | null>(null);
  const controller = useRef<ReturnType<typeof createShareListController<ShareItem[]>> | null>(null);
  useEffect(() => {
    const list = createShareListController(async () => (await api.shares(taskId)).shares, setItems);
    controller.current = list;
    void list.refresh().catch((error: {status?:number}) => { if (list.isActive()) setMessage(error?.status === 401 ? '会话已失效，请重新登录后管理分享。' : '无法加载分享记录，请重试。'); });
    return () => { list.dispose(); if (controller.current === list) controller.current = null; };
  }, [taskId]);
  async function create() {
    if (!confirmed || busy || link || !controller.current) return;
    const list = controller.current; setBusy(true); setMessage('');
    const result = await createManagedShare(() => api.createShare(taskId, { expiresInDays: days, hideRevenue }), () => list.refresh(), value => {
      if (list.isActive()) { list.invalidate(); setLink(`${location.origin}/share#${value.token}`); }
    });
    if (!list.isActive()) return;
    if (result.kind === 'unknown') setMessage((result.error as {status?:number})?.status === 401 ? '会话已失效，请先复制已有链接，再重新登录。创建结果未知，可能已创建，链接无法找回；重新登录后请刷新列表并撤销不需要的链接。' : '创建结果未知，可能已创建，链接无法找回。请先刷新列表并撤销不需要的链接。');
    else if (result.refreshFailed) setMessage((result.refreshError as {status?:number})?.status === 401 ? '会话已失效，请先复制链接，再重新登录。' : '链接已创建，但分享列表刷新失败，请先复制链接。');
    setBusy(false);
  }
  async function remove() {
    if (!revoke || !controller.current) return;
    const id = revoke, list = controller.current; setBusy(true); setMessage('');
    const result = await revokeManagedShare(() => api.revokeShare(id), () => { if (list.isActive()) { list.invalidate(); setItems(previous => previous.map(item => item.id === id ? {...item, revoked:true} : item)); setRevoke(null); } }, () => list.refresh());
    if (!list.isActive()) return;
    setMessage(result.kind === 'failed' ? (result.error as {status?:number})?.status === 401 ? '会话已失效，请先复制已有链接，再重新登录；撤销未确认，请登录后刷新列表检查。' : '撤销请求未确认，请刷新列表后检查。' : result.kind === 'revoked-refresh-failed' ? (result.error as {status?:number})?.status === 401 ? '分享已撤销，但会话已失效；请先复制已有链接，再重新登录。' : '分享已撤销，但列表刷新失败，请稍后刷新。' : '分享已撤销。');
    setBusy(false);
  }
  async function refreshList() {
    const list = controller.current; if (!list) return; setBusy(true);
    try { await list.refresh(); if (list.isActive()) setMessage('分享列表已刷新。'); }
    catch (error) { if (list.isActive()) setMessage((error as {status?:number})?.status === 401 ? '会话已失效，请先复制已有链接，再重新登录。' : '无法刷新分享列表，请稍后重试。'); }
    finally { if (list.isActive()) setBusy(false); }
  }

  const dismissState = useRef({busy, link, close});
  dismissState.current = {busy, link, close};
  const dismiss = useCallback(() => { const current = dismissState.current; if (current.busy) return; if (!current.link || window.confirm('分享链接仅显示这一次。关闭后将无法再次查看，确定关闭吗？')) current.close(); }, []);
  return <Modal title="分享与管理链接" subtitle="创建时保存只读快照，不消耗额度。" close={dismiss} wide>
    <div className="modal-body share-manager">
      <div className="share-notice"><strong>分享原始完整报告，不包含当前筛选。</strong><p>原报告期间：{period?.trim() || '未知'}</p></div>
      <label className="share-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy || !!link} />我确认公开原始完整报告的范围，不包含当前筛选。</label><p>链接只显示一次；创建后请立即复制。切换账号或离开页面后无法找回。</p>
      <label className="field">有效期<select value={days} onChange={e => setDays(Number(e.target.value) as 1 | 7 | 30)} disabled={busy}><option value={1}>1 天</option><option value={7}>7 天</option><option value={30}>30 天</option></select></label>
      <label className="share-check"><input type="checkbox" checked={hideRevenue} onChange={e => setHideRevenue(e.target.checked)} disabled={busy} />隐藏收入和付费相关内容</label>
      <p>取消勾选后，链接持有者可以查看收入和付费指标。</p>
      <button className="button primary" disabled={busy || !!link || !confirmed} onClick={() => void create()}>创建分享链接</button>
      {link && <div className="share-created" role="status"><strong>链接仅显示这一次，请现在复制保存。</strong><input aria-label="分享链接" readOnly value={link} onFocus={e => e.currentTarget.select()} /><button className="button secondary" onClick={() => void copyShareLink(link, navigator.clipboard).then(ok => setMessage(ok ? '链接已复制。' : '复制失败，请手动选择链接复制。'))}>复制链接</button></div>}
      <h3>已有分享</h3><button className="button secondary" disabled={busy} onClick={() => void refreshList()}>刷新分享列表</button><p>访问和成功注册均按匿名随机标识去重，不代表人数。</p>
      {items.length === 0 && <p>暂无分享记录。</p>}
      <ul className="share-list">{items.map(item => { const expired = Date.parse(item.expiresAt) <= Date.now(); return <li key={item.id}><div><strong>{item.revoked ? '已撤销' : expired ? '已过期' : '有效'}</strong> · 到期 {new Date(item.expiresAt).toLocaleString('zh-CN')} · {item.hideRevenue ? '隐藏收入' : '包含收入'}</div><div>访问标识 {item.views} · 成功注册标识 {item.registrations}</div>{!item.revoked && !expired && <button className="button secondary" disabled={busy} onClick={() => setRevoke(item.id)}>撤销</button>}{revoke === item.id && <div role="alert">撤销后链接将不可访问。<button className="button secondary" disabled={busy} onClick={() => void remove()}>确认撤销</button><button className="button secondary" onClick={() => setRevoke(null)}>取消</button></div>}</li>; })}</ul>
      <p role="status" aria-live="polite">{message}</p>
    </div><div className="modal-footer"><span /><button className="button secondary" onClick={dismiss}>关闭</button></div>
  </Modal>;
}
