import { useEffect, useState } from 'react';
import { api } from './api';
import type { PublicReport } from './types';
import { AuthRoot } from './AuthRoot';
import App from './App';
import './sharing.css';
import { createShareReader } from './share-flow';
import type { ShareReaderState } from './share-flow';

function makeVisitor() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const value = (n: number | null | undefined, unit = '') => n == null ? '未知' : `${n.toLocaleString('zh-CN')} ${unit}`;
const coverage = (c: {start:string;end:string} | null | undefined) => c ? `${c.start} 至 ${c.end}` : '未知';

export function Entry() {
  const [register, setRegister] = useState(false);
  const [share, setShare] = useState<ShareReaderState<PublicReport>>({token:'', visitorToken:'', report:null, status:'loading'});
  useEffect(() => {
    if (location.pathname !== '/share') return;
    const reader = createShareReader<PublicReport>({ makeVisitor, read: async token => (await api.readShare(token)).report, visit: (token, visitor) => api.visitShare(token, visitor), publish: setShare });
    const change = () => { setRegister(false); reader.open(location.hash.slice(1)); };
    window.addEventListener('hashchange', change); change();
    return () => { window.removeEventListener('hashchange', change); reader.dispose(); };
  }, []);
  if (location.pathname !== '/share') return <AuthRoot><App /></AuthRoot>;
  if (register && share.visitorToken && location.hash.slice(1) === share.token) return <AuthRoot attribution={{shareToken: share.token, visitorToken: share.visitorToken}}><App /></AuthRoot>;
  return <PublicShare key={`${share.token}:${share.visitorToken}`} share={share} onRegister={() => { if (location.hash.slice(1) === share.token) setRegister(true); }} />;
}
function PublicShare({ share, onRegister }: {share:ShareReaderState<PublicReport>; onRegister:()=>void}) {
  const { report, status } = share;
  const [session, setSession] = useState<'checking' | 'signed-in' | 'anonymous' | 'error'>('checking');
  const [checkingAction, setCheckingAction] = useState(false);
  async function checkSession() { try { const result = await api.session(); setSession(result.user ? 'signed-in' : 'anonymous'); return result.user; } catch { setSession('error'); return undefined; } }
  useEffect(() => { void checkSession(); }, []);
  async function register() { setCheckingAction(true); const current = await checkSession(); setCheckingAction(false); if (current === null) onRegister(); }
  return <main className="public-share"><header><strong>DataAgent<span>.</span></strong><span>只读分享</span></header><div role="status" aria-live="polite">{status === 'loading' ? '正在加载分享报告…' : status === 'unavailable' ? '分享不可用，链接可能无效、已过期或已撤销。' : ''}</div>{report && <article>
    <h1>数据分析报告</h1><p className="share-lead">只读快照 · {report.source === 'ai' ? '原报告含 AI 辅助分析' : '确定性分析'} · 统计期间：{coverage(report.period)}</p>
    <p className="share-notice">{report.sample === true ? '示例数据，不代表真实业务。' : report.sample === false ? '数据源标记为上传数据。' : '数据来源是否为示例未知。'}</p>
    <p>本页面为 DataAgent 提供的分析快照，非官方结论；请结合数据范围和业务背景判断。</p>
    <section><h2>关键指标</h2><div className="share-metrics">{report.metrics.map(m => <div className="share-metric" key={m.id}><h3>{m.label}</h3><strong>{value(m.value, m.unit)}</strong><p>覆盖：{coverage(m.coverage)}</p><p>口径：{m.method || '未知'}</p></div>)}</div></section>
    <section><h2>每日数据</h2>{report.dailyTruncated && <p>每日数据仅展示最多 366 条；完整指标不局限于此片段。</p>}<div className="share-table-wrap"><table><thead><tr><th>日期</th><th>活跃用户</th><th>新增用户</th>{!report.hideRevenue && <><th>收入</th><th>付费人数</th></>}</tr></thead><tbody>{report.daily.map(row => <tr key={row.date}><td>{row.date}</td><td>{value(row.dau)}</td><td>{value(row.newUsers)}</td>{!report.hideRevenue && <><td>{value(row.revenue, report.currency || '')}</td><td>{value(row.payers)}</td></>}</tr>)}</tbody></table></div></section>
    <section><h2>留存</h2>{report.retentionTruncated && <p>留存数据仅展示最多 366 条；完整指标不局限于此片段。</p>}<div className="share-table-wrap"><table><thead><tr><th>注册日期</th><th>用户数</th><th>次日</th><th>第 7 日</th></tr></thead><tbody>{report.retention.map(row => <tr key={row.date}><td>{row.date}</td><td>{value(row.users)}</td><td>{value(row.d1, '%')}</td><td>{value(row.d7, '%')}</td></tr>)}</tbody></table></div></section>
    <section><h2>统计方法</h2><ul>{report.methodology.map((item, i) => <li key={i}>{item}</li>)}</ul></section>
    <div className="no-print">{session === 'signed-in' ? <button className="button primary" onClick={() => location.assign('/')}>进入当前工作台</button> : session === 'anonymous' ? <button className="button primary" disabled={checkingAction} onClick={() => void register()}>创建 DataAgent 账号</button> : session === 'error' ? <><p role="alert">无法确认登录状态，请重试。</p><button className="button secondary" onClick={() => void checkSession()}>重试</button></> : <p role="status">正在确认登录状态…</p>}</div>
  </article>}</main>;
}
