import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronRight, FileText, Gamepad2, Menu, MessageSquare, PanelRight, Plus, RefreshCw, Settings2, Sparkles, Wifi, Zap } from 'lucide-react';
import { api } from './api';
import { useAuth } from './auth-context';
import type { Bootstrap, Dataset, Mode, Settings, Skill, Task, View, Wallet } from './types';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/ReportView';
import { RunPanel } from './components/RunPanel';
import { DataPage, ReportsPage, SkillsPage, WalletPage } from './components/Pages';
import { DataPreview, DomainModal, HelpModal, NewAnalysis, SettingsModal, SkillModal } from './components/Modals';
import { AccountModal } from './components/AccountModal';
import { ReportDownload } from './components/ReportDownload';
import { Logo, Spinner, Toast } from './components/ui';

const viewNames: Record<View, string> = { workspace: '分析工作台', datasets: '数据源', reports: '分析报告', skills: 'Skill 能力库', wallet: '额度与记录' };
export default function App() {
  const { runtime, user } = useAuth();
  const cloud = runtime.mode === 'cloud';
  const [accountOpen, setAccountOpen] = useState(false);
  const [data, setData] = useState<Bootstrap | null>(null); const [error, setError] = useState(''); const [view, setView] = useState<View>('workspace'); const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('collaborative'); const [newDraft, setNewDraft] = useState<{ goal: string; datasetId?: string } | null>(null); const [settingsOpen, setSettingsOpen] = useState(false); const [domainOpen, setDomainOpen] = useState(false); const [helpOpen, setHelpOpen] = useState(false); const [preview, setPreview] = useState<Dataset | null>(null); const [skill, setSkill] = useState<Skill | null>(null); const [fullReport, setFullReport] = useState(false); const [sidebarOpen, setSidebarOpen] = useState(false); const [panelOpen, setPanelOpen] = useState(false); const [exportOpen, setExportOpen] = useState(false); const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const notify = useCallback((text: string, isError = false) => setToast({ text, error: isError }), []);
  const load = useCallback(async () => { setError(''); try { const next = await api.bootstrap(); setData(next); setActiveId(prev => prev && next.tasks.some(t => t.id === prev) ? prev : next.tasks[0]?.id || null); } catch(e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(null), 5500); return () => clearTimeout(timeout); }, [toast]);
  const task = data?.tasks.find(t => t.id === activeId);
  const onUpdate = useCallback((next: Task, wallet?: Wallet) => setData(prev => prev ? { ...prev, wallet: wallet || prev.wallet, tasks: prev.tasks.some(t => t.id === next.id) ? prev.tasks.map(t => t.id === next.id ? next : t) : [next, ...prev.tasks] } : prev), []);
  useEffect(() => {
    if (!task || !['running', 'awaiting_approval'].includes(task.status)) return;
    let alive = true; let timeout: ReturnType<typeof setTimeout>; let failures = 0;
    async function poll() {
      try { const result = await api.task(activeId!); if (!alive) return; onUpdate(result.task, result.wallet); failures = 0; if (!['running', 'awaiting_approval'].includes(result.task.status)) { if (result.task.status === 'completed') notify('分析已完成，报告已保存。'); return; } }
      catch(e) { if (alive && ++failures === 3) notify((e as Error).message, true); }
      if (alive) timeout = setTimeout(poll, 1000);
    }
    timeout = setTimeout(poll, 600);
    return () => { alive = false; clearTimeout(timeout); };
  }, [activeId, task?.status, onUpdate, notify]);
  const hasBackgroundTasks = Boolean(data?.tasks.some(t => t.id !== activeId && ['running', 'awaiting_approval'].includes(t.status)));
  useEffect(() => {
    if (!hasBackgroundTasks) return;
    let alive = true;
    const interval = setInterval(() => { api.bootstrap().then(next => { if (alive) setData(next); }).catch(() => {}); }, 2500);
    return () => { alive = false; clearInterval(interval); };
  }, [hasBackgroundTasks]);
  const onNew = useCallback((goal = '', datasetId?: string) => { setNewDraft({ goal, datasetId }); setExportOpen(false); }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { const target = event.target as HTMLElement; if (event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey && !event.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !target.isContentEditable && !newDraft && !settingsOpen && !preview && !helpOpen && !domainOpen && !skill && !accountOpen) { event.preventDefault(); onNew(); } if (event.key === 'Escape') { setSidebarOpen(false); setPanelOpen(false); setExportOpen(false); } };
    document.addEventListener('keydown', handleKey); return () => document.removeEventListener('keydown', handleKey);
  }, [newDraft, settingsOpen, preview, helpOpen, domainOpen, skill, accountOpen, onNew]);
  const closeAccount = useCallback(() => setAccountOpen(false), []);
  const closeNew = useCallback(() => setNewDraft(null), []); const closeSettings = useCallback(() => setSettingsOpen(false), []); const closePreview = useCallback(() => setPreview(null), []); const closeDomain = useCallback(() => setDomainOpen(false), []); const closeHelp = useCallback(() => setHelpOpen(false), []); const closeSkill = useCallback(() => setSkill(null), []);
  function selectTask(next: Task, full = false) { setActiveId(next.id); setView('workspace'); setFullReport(full); }
  function onDataset(dataset: Dataset) { setData(prev => prev ? { ...prev, datasets: [dataset, ...prev.datasets.filter(d => d.id !== dataset.id)] } : prev); }
  function onSettingsSaved(settings: Settings) { setData(prev => prev ? { ...prev, settings } : prev); }
  if (!data) return <div className="app-loading"><div className="loading-brand"><Logo /><strong>DataAgent.</strong></div>{error ? <><h2>连接分析服务时遇到问题</h2><p role="alert">{error}</p><button className="button primary" onClick={() => void load()}><RefreshCw size={15} />重试连接</button><small>{cloud ? '请检查网络；若问题持续，请联系本服务管理员。' : '开发环境请运行 npm run dev；生产环境请运行 npm start。'}</small></> : <><Spinner size={24} /><p role="status">正在准备你的分析工作空间…</p></>}</div>;
  const currentDataset = data.datasets.find(d => d.id === task?.datasetId);
  return <div className={`app-shell ${view === 'workspace' ? 'with-run-panel' : ''}`}>
    <a className="skip-link" href="#main-content">跳到主内容</a>
    <Sidebar view={view} setView={setView} wallet={data.wallet} tasks={data.tasks} selectedId={activeId} selectTask={selectTask} onNew={() => onNew()} onSettings={() => setSettingsOpen(true)} onHelp={() => setHelpOpen(true)} onAccount={() => { setSidebarOpen(false); setAccountOpen(true); }} open={sidebarOpen} close={() => setSidebarOpen(false)} onDomain={() => setDomainOpen(true)} />
    <div className="app-main"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button><span>工作空间</span><ChevronRight size={12} /><strong>{viewNames[view]}</strong></div><div className="topbar-right"><span className="connection-state" title={cloud ? window.location.host : undefined}><span className="online-dot" />{cloud ? '云端服务已连接' : '本地服务已连接'}</span><span className="topbar-divider" /><button className={`model-status ${data.settings.hasKey ? 'configured' : ''}`} onClick={() => setSettingsOpen(true)}><Sparkles size={13} />{cloud && !runtime.modelHosts?.length ? 'AI 暂未开放' : data.settings.hasKey ? '模型已配置' : '连接 AI 模型'}<ArrowRight size={12} /></button><button className="topbar-avatar" onClick={() => cloud ? setAccountOpen(true) : setHelpOpen(true)} aria-label={cloud ? `账号与安全，${user?.displayName}，用户名 ${user?.username}` : '打开使用指南'} title={user ? `${user.displayName} @${user.username}` : undefined}>{user?.displayName.slice(0, 1).toUpperCase() || 'D'}</button></div></header>
      <div className="page-toolbar no-print"><button className="domain-switch" onClick={() => setDomainOpen(true)}><Gamepad2 size={15} /><span>游戏运营</span><ChevronDown size={12} /></button><div className="toolbar-right">{view === 'workspace' && <><div className="mode-switch segmented" aria-label="新分析默认工作方式" title="用于下一次新建分析"><button className={mode === 'collaborative' ? 'selected' : ''} onClick={() => setMode('collaborative')}><MessageSquare size={13} />协作模式</button><button className={mode === 'automatic' ? 'selected' : ''} onClick={() => setMode('automatic')}><Zap size={13} />自动模式</button></div>{task?.report && <div className="export-dropdown"><button className="button secondary export-button" onClick={() => setExportOpen(!exportOpen)} aria-expanded={exportOpen}><ArrowDownToLine size={14} /><span>导出报告</span><ChevronDown size={11} /></button>{exportOpen && <><button className="dropdown-dismiss" aria-label="关闭导出菜单" onClick={() => setExportOpen(false)} /><div className="dropdown-menu"><ReportDownload id={task.id} name={task.title} label="下载 Markdown" onDone={() => setExportOpen(false)} onError={message => notify(message, true)}><FileText size={14} />下载 Markdown</ReportDownload><button onClick={() => { setExportOpen(false); setFullReport(true); setTimeout(() => window.print(), 200); }}><ArrowDownToLine size={14} />打印 / 保存 PDF</button></div></>}</div>}</>}<button className="button primary toolbar-new" onClick={() => onNew()}><Plus size={15} /><span>新建分析</span></button></div></div>
      <main id="main-content" className={`page-content ${view === 'workspace' ? 'workspace-content' : 'inner-page'}`}>
        {view === 'workspace' && <Workspace task={task} dataset={currentDataset} onNew={goal => onNew(goal, task?.datasetId)} onShowData={setPreview} full={fullReport} setFull={setFullReport} />}
        {view === 'datasets' && <DataPage datasets={data.datasets} onUploaded={onDataset} onPreview={setPreview} onAnalyze={d => onNew('', d.id)} onRemoved={id => setData(prev => prev ? { ...prev, datasets: prev.datasets.filter(d => d.id !== id) } : prev)} notify={notify} />}
        {view === 'reports' && <ReportsPage tasks={data.tasks} onSelect={t => selectTask(t, true)} onNew={() => onNew()} />}
        {view === 'skills' && <SkillsPage skills={data.skills} onSelect={setSkill} />}
        {view === 'wallet' && <WalletPage wallet={data.wallet} notify={notify} />}
      </main>
    </div>
    {view === 'workspace' && <><button className="mobile-agent-toggle button primary" onClick={() => setPanelOpen(!panelOpen)}><Sparkles size={16} />{task?.status === 'awaiting_approval' ? '需要你的确认' : 'AI 工作动态'}<PanelRight size={15} /></button>{panelOpen && <button className="run-panel-shade" aria-label="关闭 AI 动态" onClick={() => setPanelOpen(false)} />}<RunPanel task={task} open={panelOpen} close={() => setPanelOpen(false)} onUpdate={onUpdate} onError={m => notify(m, true)} onNew={goal => onNew(goal, task?.datasetId)} /></>}
    {newDraft && <NewAnalysis datasets={data.datasets} defaultMode={mode} settings={data.settings} initialGoal={newDraft.goal} initialDatasetId={newDraft.datasetId} close={closeNew} onDataset={onDataset} onCreated={(next, wallet) => { onUpdate(next, wallet); selectTask(next); setPanelOpen(window.matchMedia('(max-width: 1050px)').matches); notify(`${next.mode === 'collaborative' ? '协作' : '自动'}分析已开始，已冻结 20 服务额度。`); }} onSettings={() => { closeNew(); setSettingsOpen(true); }} />}
    {settingsOpen && <SettingsModal settings={data.settings} close={closeSettings} onSaved={onSettingsSaved} notify={notify} />}
    {accountOpen && cloud && <AccountModal close={closeAccount} />}
    {preview && <DataPreview dataset={preview} close={closePreview} onAnalyze={() => { onNew('', preview.id); closePreview(); }} />}
    {domainOpen && <DomainModal domains={data.domains} close={closeDomain} />}
    {helpOpen && <HelpModal close={closeHelp} />}
    {skill && <SkillModal skill={skill} close={closeSkill} />}
    {toast && <Toast message={toast.text} error={toast.error} close={() => setToast(null)} />}
  </div>;
}
