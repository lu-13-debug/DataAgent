import { ArrowRight, ArrowUpRight, BookOpen, ChevronRight, CircleHelp, Coins, Database, FileChartColumnIncreasing, Gamepad2, LayoutDashboard, Plus, Settings2, Sparkles, UserRound, X } from 'lucide-react';
import type { Task, View, Wallet } from '../types';
import { useAuth } from '../auth-context';
import { Logo } from './ui';
import { ANALYSIS_COST } from '../product-state';

const items = [
  { id: 'workspace' as const, label: '分析工作台', icon: LayoutDashboard },
  { id: 'datasets' as const, label: '数据源', icon: Database },
  { id: 'reports' as const, label: '分析报告', icon: FileChartColumnIncreasing },
  { id: 'skills' as const, label: 'Skill 能力库', icon: BookOpen },
];
export function Sidebar({ view, setView, wallet, tasks, selectedId, selectTask, onNew, onSettings, onHelp, onAccount, open, close, onDomain, collapsed = false }: {
  view: View; setView: (view: View) => void; wallet: Wallet; tasks: Task[]; selectedId: string | null;
  selectTask: (task: Task) => void; onNew: () => void; onSettings: () => void; onHelp: () => void; onAccount: () => void; open: boolean; close: () => void; onDomain: () => void; collapsed?: boolean;
}) {
  const { runtime, user } = useAuth();
  const cloud = runtime.mode === 'cloud';
  return <>
    {open && <button className="sidebar-shade" onClick={close} aria-label="收起导航" />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setView('workspace'); close(); }}><Logo /><span>DataAgent<span className="brand-dot">.</span></span></a>
      <button className="icon-button mobile-sidebar-close" aria-label="收起导航" onClick={close}><X size={19} /></button>
      <button className="project-select" onClick={onDomain} aria-label="查看领域说明"><span className="project-icon"><Gamepad2 size={18} /></span><span><strong>工作空间</strong><small>游戏运营</small></span><ChevronRight size={14} /></button>
      <button className="sidebar-new" aria-label="新建分析" title="新建分析" onClick={onNew}><Plus size={17} /><span>新建分析</span><kbd>N</kbd></button>
      <div className="nav-label">工作空间</div>
      <nav aria-label="主导航">{items.map(item => <button key={item.id} aria-label={item.label} title={item.label} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => { setView(item.id); close(); }}><item.icon size={18} strokeWidth={1.7} /><span>{item.label}</span>{item.id === 'reports' && <span className="nav-count">{tasks.filter(t => t.status === 'completed').length}</span>}{view === item.id && <span className="active-dot" />}</button>)}</nav>
      <div className="recent-title"><span className="nav-label">最近分析</span><span>{tasks.length}</span></div>
      <div className="recent-tasks">{tasks.slice(0, 4).map(task => <button key={task.id} title={task.title} aria-label={task.title} className={`recent-task ${selectedId === task.id && view === 'workspace' ? 'selected' : ''}`} onClick={() => { selectTask(task); close(); }}><span className={`task-dot ${task.status}`} /><span>{task.title}</span><ChevronRight size={12} /></button>)}</div>
      <button className="recent-all text-button" aria-label="查看全部分析" title="查看全部分析" onClick={() => { setView('reports'); close(); }}><span>查看全部分析</span><ArrowRight size={13} /></button>
      <div className="sidebar-bottom">
        {collapsed && <button className="nav-item rail-wallet" aria-label={`额度与记录，可用 ${wallet.balance.toLocaleString()} 额度`} title={`额度与记录：${wallet.balance.toLocaleString()}`} onClick={() => { setView('wallet'); close(); }}><Coins size={17} /><small>{wallet.balance.toLocaleString()}</small></button>}
        <div className="credit-card"><div className="credit-heading"><Coins size={16} /><span>服务额度</span><span className="trial-tag">{cloud ? '账号试用额度' : '本地试用额度'}</span></div><div className="credit-balance">{wallet.balance.toLocaleString()}<small>可用额度</small></div><p className="credit-quota-note">{wallet.balance < ANALYSIS_COST ? `额度不足，分析需 ${ANALYSIS_COST} 额度` : `每次分析 ${ANALYSIS_COST} 额度`}</p><div className="credit-line"><i style={{ width: `${Math.min(100, wallet.balance / Math.max(500, wallet.balance + wallet.spent + wallet.frozen) * 100)}%` }} /></div><button onClick={() => { setView('wallet'); close(); }}>查看使用记录 <ArrowUpRight size={13} /></button></div>
        <button className="nav-item" aria-label="模型与 API 设置" title="模型与 API 设置" onClick={onSettings}><Settings2 size={17} /><span>模型与 API 设置</span></button>
        {cloud && <button className="nav-item" aria-label="账号与安全" title="账号与安全" onClick={onAccount}><UserRound size={17} /><span>账号与安全</span></button>}
        <button className="nav-item" aria-label="使用指南" title="使用指南" onClick={onHelp}><CircleHelp size={17} /><span>使用指南</span><ArrowUpRight size={13} /></button>
        <div className="account"><div className="avatar">{user?.displayName.slice(0, 1).toUpperCase() || 'D'}</div><span><strong title={user?.displayName}>{user?.displayName || '我的工作空间'}</strong><small title={user?.username}><span className="online-dot" />{user ? `@${user.username}` : '本地运行'}</small></span><Sparkles size={15} /></div>
      </div>
    </aside>
  </>;
}
