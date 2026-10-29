import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronRight, FileText, Gamepad2, Menu, MessageSquare, PanelLeftClose, PanelLeftOpen, PanelRight, Plus, RefreshCw, Search, Settings2, Sparkles, SunMoon, Wifi, Zap } from 'lucide-react';
import { api } from './api';
import { useAppearance } from './appearance-context';
import { AppearanceSettings } from './components/AppearanceSettings';
import { useAuth } from './auth-context';
import type { Bootstrap, Dataset, Mode, Settings, Skill, Task, TaskSnapshot, TaskSummary, View, Wallet } from './types';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/ReportView';
import { RunPanel } from './components/RunPanel';
import { DataPage, ReportsPage, SkillsPage, WalletPage } from './components/Pages';
import { DataPreview, DomainModal, HelpModal, NewAnalysis, SettingsModal, SkillModal } from './components/Modals';
import { AccountModal } from './components/AccountModal';
import { ReportDownload } from './components/ReportDownload';
import { Logo, Spinner, Toast } from './components/ui';
import { OnboardingChecklist } from './components/OnboardingChecklist';
import { useOnboarding } from './use-onboarding';
import { isPresetSample } from './onboarding';
import { analysisAccess } from './product-state';
import { useTaskMonitor } from './use-task-monitor';
import { taskSummaries, setDesktopState, setDesktopSummaries, subscribeDesktopNew } from './desktop-tray';
import { mergeWalletState, mergeTaskDetails, mergeTaskSummaries } from './task-monitor';
import { choiceKey, readChoices } from './analysis-draft';
import { AnalysisTemplates } from './components/AnalysisTemplates';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutHelp } from './components/ShortcutHelp';
import { shortcutAction } from './commands';
import type { Command } from './commands';
import { continuationDraft } from './report-assets';
import { useReportMetadata } from './use-report-metadata';
import './experience.css';
import './data-workflow.css';
import './task-control.css';
import './commands.css';
import './report-assets.css';

const viewNames: Record<View, string> = { workspace: '分析工作台', datasets: '数据源', reports: '分析报告', skills: 'Skill 能力库', wallet: '额度与记录' };
export default function App() {
  const { runtime, user } = useAuth();
  const appearance = useAppearance();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const cloud = runtime.mode === 'cloud';
  const [accountOpen, setAccountOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false); const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [exportFocusRequest, setExportFocusRequest] = useState(0);
  const [helpSection, setHelpSection] = useState<'general' | 'collaboration'>('general');
  const [data, setData] = useState<Bootstrap | null>(null); const [error, setError] = useState(''); const [view, setView] = useState<View>('workspace'); const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() => { try { return readChoices(localStorage, choiceKey(runtime.mode, user?.id, window.location.origin)).mode || 'collaborative'; } catch { return 'collaborative'; } }); const [newDraft, setNewDraft] = useState<{ goal: string; datasetId?: string; mode?: Mode; context?: string; source?: Task } | null>(null); const [settingsOpen, setSettingsOpen] = useState(false); const [domainOpen, setDomainOpen] = useState(false); const [helpOpen, setHelpOpen] = useState(false); const [preview, setPreview] = useState<Dataset | null>(null); const [skill, setSkill] = useState<Skill | null>(null); const [fullReport, setFullReport] = useState(false); const [sidebarOpen, setSidebarOpen] = useState(false); const [panelOpen, setPanelOpen] = useState(false); const [exportOpen, setExportOpen] = useState(false); const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const onboarding = useOnboarding(data);
  const sampleReport = data?.tasks.find(candidate => Boolean(candidate.report) && isPresetSample(candidate));
  const notify = useCallback((text: string, isError = false) => setToast({ text, error: isError }), []);
  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try {
      const next = await api.bootstrap(signal); if (signal?.aborted) return;
      setData(previous => previous ? { ...previous, ...mergeWalletState(previous, next), tasks: mergeTaskDetails(previous.tasks, next.tasks) } : next);
      setActiveId(previous => previous || next.tasks[0]?.id || null);
    } catch(e) { if (!signal?.aborted) setError((e as Error).message); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(null), 5500); return () => clearTimeout(timeout); }, [toast]);
  const task = data?.tasks.find(t => t.id === activeId);
  const onUpdate = useCallback((next: Task, wallet?: Wallet, walletVersion?: number) => setData(previous => {
    if (!previous) return previous;
    return { ...previous, ...(wallet ? mergeWalletState(previous, { wallet, walletVersion }) : {}), tasks: mergeTaskDetails(previous.tasks, [next]) };
  }), []);
  const onSnapshot = useCallback((snapshot: TaskSnapshot) => setData(previous => previous ? { ...previous, ...mergeWalletState(previous, snapshot), tasks: mergeTaskSummaries(previous.tasks, snapshot.summaries) } : previous), []);
  const reportMetadata = useReportMetadata(onUpdate, notify);
  const onCalibrated = useCallback((next: Bootstrap) => setData(previous => previous ? { ...previous, ...mergeWalletState(previous, next), tasks: mergeTaskDetails(previous.tasks, next.tasks) } : next), []);
  const onTerminal = useCallback((next: TaskSummary) => notify(next.status === 'completed' ? '分析已完成，报告已保存。' : '分析未完成，冻结额度已释放；请查看失败原因。', next.status === 'failed'), [notify]);
  const focusTask = useCallback((id: string) => { setActiveId(id); setView('workspace'); setFullReport(true); setPanelOpen(window.matchMedia('(max-width: 1050px)').matches); }, []);
  const monitor = useTaskMonitor({ data, activeId, runtime, onSnapshot, onDetails: onUpdate, onBootstrap: onCalibrated, onTerminal, onFocusTask: focusTask });
  const onNew = useCallback((goal = '', datasetId?: string, draftMode?: Mode) => { if (datasetId) onboarding.mark('selectedData'); setNewDraft({ goal, datasetId, mode: draftMode }); setExportOpen(false); }, [onboarding.mark]);
  useEffect(() => {
    const bridge = window.dataagentDesktop;
    if (!bridge) return;
    if (!data) return;
    setDesktopState(bridge, 'ready');
    setDesktopSummaries(bridge, taskSummaries(data.tasks));
  }, [data]);
  useEffect(() => {
    const bridge = window.dataagentDesktop;
    if (!bridge) return;
    const unsubscribe = subscribeDesktopNew(bridge, () => { if (data) onNew(); });
    return () => { unsubscribe(); setDesktopSummaries(bridge, []); };
  }, [Boolean(data), onNew]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const dialogOpen = Boolean(document.querySelector('[role="dialog"]'));
      const action = shortcutAction({ key: event.key, keyCode: event.keyCode, repeat: event.repeat, isComposing: event.isComposing, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, target: event.target as HTMLElement }, dialogOpen, commandOpen);
      if (action) event.preventDefault();
      if (action === 'commands') setCommandOpen(open => !open);
      if (action === 'new') onNew();
      if (action === 'shortcuts') setShortcutsOpen(true);
      if (action === 'appearance') setAppearanceOpen(true);
      if (event.key === 'Escape' && !dialogOpen && !event.isComposing && event.keyCode !== 229) { if (exportOpen) document.querySelector<HTMLElement>('.export-button')?.focus(); setSidebarOpen(false); setPanelOpen(false); setExportOpen(false); }
    };
    document.addEventListener('keydown', handleKey); return () => document.removeEventListener('keydown', handleKey);
  }, [commandOpen, exportOpen, onNew]);
  const closeAppearance = useCallback(() => setAppearanceOpen(false), []);
  const closeCommands = useCallback(() => setCommandOpen(false), []); const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const onContinue = useCallback((source: Task) => { const draft = continuationDraft(source); setNewDraft({ goal: draft.goal, datasetId: source.datasetId, context: draft.context, source }); setExportOpen(false); }, []);
  const closeAccount = useCallback(() => setAccountOpen(false), []);
  const closeNew = useCallback(() => setNewDraft(null), []); const closeSettings = useCallback(() => setSettingsOpen(false), []); const closePreview = useCallback(() => setPreview(null), []); const closeDomain = useCallback(() => setDomainOpen(false), []); const closeHelp = useCallback(() => setHelpOpen(false), []); const closeSkill = useCallback(() => setSkill(null), []);
  function selectTask(next: Task, full = false) { setActiveId(next.id); setView('workspace'); setFullReport(full); }
  function openHelp() { setHelpSection('general'); setHelpOpen(true); }
  function showSampleReport() {
    if (sampleReport) { selectTask(sampleReport, true); onboarding.mark('viewedSample'); }
    else openHelp();
  }
  function showData(dataset: Dataset) { onboarding.mark('selectedData'); setPreview(dataset); }
  function onDataset(dataset: Dataset) { onboarding.mark('selectedData'); setData(prev => prev ? { ...prev, datasets: [dataset, ...prev.datasets.filter(d => d.id !== dataset.id)] } : prev); }
  function onSettingsSaved(settings: Settings) { setData(prev => prev ? { ...prev, settings } : prev); }
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [view]);
  useEffect(() => {
    if (view !== 'workspace' || !fullReport) return;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('.sample-report-banner') || document.querySelector<HTMLElement>('.full-report');
      if (target) {
        const headerHeight = document.querySelector('.topbar')?.getBoundingClientRect().height || 0;
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - headerHeight - 20, behavior: 'auto' });
      }
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [view, fullReport, activeId]);
  useEffect(() => {
    if (!exportOpen || view !== 'workspace') return;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>('.export-dropdown .dropdown-menu button')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [exportOpen, view, exportFocusRequest]);
  if (!data) return <div className="app-loading"><div className="loading-brand"><Logo /><strong>DataAgent.</strong></div>{error ? <><h2>连接分析服务时遇到问题</h2><p role="alert">{error}</p><button className="button primary" onClick={() => void load()}><RefreshCw size={15} />重试连接</button><small>{cloud ? '请检查网络；若问题持续，请联系本服务管理员。' : '开发环境请运行 npm run dev；生产环境请运行 npm start。'}</small></> : <><Spinner size={24} /><p role="status">正在准备你的分析工作空间…</p></>}</div>;
  const access = analysisAccess(runtime, data.settings, data.wallet);
  const currentDataset = data.datasets.find(d => d.id === task?.datasetId);
  const commands: Command[] = [
    ...Object.entries(viewNames).map(([id, title]) => ({ id: `page:${id}`, title, group: '页面', keywords: id, run: () => { setView(id as View); setSidebarOpen(false); } })),
    { id: 'action:new', title: '新建分析', group: '动作', hint: '在摘要页明确确认后才创建任务', keywords: 'new analysis', run: () => onNew() },
    { id: 'action:collaborative', title: '下一次分析使用协作模式', group: '动作', hint: '计划和报告生成前由你确认', run: () => { setMode('collaborative'); notify('下一次新建分析使用协作模式，创建时仍可修改。'); } },
    { id: 'action:automatic', title: '下一次分析使用自动模式', group: '动作', hint: '不修改已经创建的任务', run: () => { setMode('automatic'); notify('下一次新建分析使用自动模式，创建时仍可修改。'); } },
    { id: 'action:settings', title: '模型与 API 设置', group: '动作', keywords: 'key model settings', run: () => setSettingsOpen(true) },
    { id: 'appearance:open', title: '打开显示设置', group: '动作', run: () => setAppearanceOpen(true) },
    { id: 'appearance:view', title: '切换简洁版 / 正常版', group: '动作', run: () => appearance.setView(appearance.view === 'concise' ? 'standard' : 'concise') },
    ...(['system', 'light', 'dark'] as const).map(theme => ({ id: `appearance:${theme}`, title: theme === 'system' ? '主题跟随系统' : theme === 'light' ? '浅色主题' : '深色主题', group: '动作', run: () => appearance.setTheme(theme) })),
    { id: 'action:help', title: '使用指南', group: '动作', keywords: 'help', run: openHelp },
    { id: 'action:shortcuts', title: '查看全部快捷键', group: '动作', keywords: 'keyboard shortcuts', run: () => setShortcutsOpen(true) },
    ...(task?.status === 'completed' && task.report ? [{ id: 'action:export', title: '导出当前报告', group: '动作', hint: task.title, keywords: 'export download', run: () => { setView('workspace'); setFullReport(true); setExportOpen(true); setExportFocusRequest(request => request + 1); } }] : []),
    ...data.tasks.filter(item => item.status === 'completed').map(item => ({ id: `report:${item.id}`, title: item.title, group: '报告', hint: item.datasetName, run: () => selectTask(item, true) })),
    ...data.datasets.map(item => ({ id: `data:${item.id}`, title: item.name, group: '数据源', hint: `${item.rowCount.toLocaleString()} 行 · ${item.dateRange.start} 至 ${item.dateRange.end}`, run: () => showData(item) })),
    ...data.skills.map(item => ({ id: `skill:${item.id}`, title: item.name, group: 'Skill', hint: item.description, keywords: item.id, run: () => setSkill(item) })),
  ];
  return <div className={`app-shell ${view === 'workspace' ? 'with-run-panel' : ''} ${appearance.railCollapsed ? 'rail-collapsed' : ''}`}>
    <a className="skip-link" href="#main-content">跳到主内容</a>
    <Sidebar collapsed={appearance.railCollapsed} view={view} setView={setView} wallet={data.wallet} tasks={data.tasks} selectedId={activeId} selectTask={selectTask} onNew={() => onNew()} onSettings={() => setSettingsOpen(true)} onHelp={openHelp} onAccount={() => { setSidebarOpen(false); setAccountOpen(true); }} open={sidebarOpen} close={() => setSidebarOpen(false)} onDomain={() => setDomainOpen(true)} />
    <div className="app-main"><header className="topbar"><div className="breadcrumb"><button className="icon-button rail-toggle" aria-label={appearance.railCollapsed ? "展开侧栏" : "折叠侧栏"} title={appearance.railCollapsed ? "展开侧栏" : "折叠侧栏"} aria-pressed={appearance.railCollapsed} onClick={() => appearance.setRailCollapsed(!appearance.railCollapsed)}>{appearance.railCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button><span>工作空间</span><ChevronRight size={12} /><strong>{viewNames[view]}</strong></div><div className="topbar-right"><span className={`connection-state ${monitor.connection === 'reconnecting' ? 'disconnected' : ''}`} role="status" aria-live="polite" title={cloud ? window.location.host : undefined}><span className="online-dot" /><span className="connection-label">{monitor.connection === 'reconnecting' ? '连接中断，正在重连' : cloud ? '云端服务已连接' : '本地服务已连接'}</span></span><button className="icon-button command-trigger" aria-label="打开命令面板" title="查找并执行（Ctrl / ⌘ K）" onClick={() => setCommandOpen(true)}><Search size={17} /></button><button className="icon-button" aria-label="显示设置" title="显示设置（Ctrl / ⌘ + Shift + D）" onClick={() => setAppearanceOpen(true)}><SunMoon size={17} /></button><span className="topbar-divider" /><button className={`model-status ${access.canUseAI ? 'configured' : ''}`} onClick={() => setSettingsOpen(true)}><Sparkles size={13} />{access.modelLabel}<ArrowRight size={12} /></button>{!access.canStart && <span className="quota-status" role="status">额度不足 · 需 20 额度</span>}<button className="topbar-avatar" onClick={() => cloud ? setAccountOpen(true) : openHelp()} aria-label={cloud ? `账号与安全，${user?.displayName}，用户名 ${user?.username}` : '打开使用指南'} title={user ? `${user.displayName} @${user.username}` : undefined}>{user?.displayName.slice(0, 1).toUpperCase() || 'D'}</button></div></header>
      <div className="page-toolbar no-print"><button className="domain-switch" onClick={() => setDomainOpen(true)}><Gamepad2 size={15} /><span>游戏运营</span><ChevronDown size={12} /></button><div className="toolbar-right">{view === 'workspace' && <><div className="mode-switch segmented" aria-label="新分析默认工作方式" title="用于下一次新建分析"><button className={mode === 'collaborative' ? 'selected' : ''} onClick={() => setMode('collaborative')}><MessageSquare size={13} />协作模式</button><button className={mode === 'automatic' ? 'selected' : ''} onClick={() => setMode('automatic')}><Zap size={13} />自动模式</button></div>{task?.status === 'completed' && task.report && <div className="export-dropdown"><button className="button secondary export-button" onClick={() => setExportOpen(!exportOpen)} aria-expanded={exportOpen}><ArrowDownToLine size={14} /><span>导出报告</span><ChevronDown size={11} /></button>{exportOpen && <><button className="dropdown-dismiss" aria-label="关闭导出菜单" onClick={() => setExportOpen(false)} /><div className="dropdown-menu"><ReportDownload id={task.id} name={task.title} label="下载原始 Markdown" onDone={() => setExportOpen(false)} onError={message => notify(message, true)}><FileText size={14} />下载原始 Markdown</ReportDownload><button onClick={() => { setExportOpen(false); setFullReport(true); setTimeout(() => window.print(), 200); }}><ArrowDownToLine size={14} />打印 / 保存 PDF</button></div></>}</div>}</>}<button className="button primary toolbar-new" onClick={() => onNew()}><Plus size={15} /><span>新建分析</span></button></div></div>
      <main id="main-content" tabIndex={-1} className={`page-content ${view === 'workspace' ? 'workspace-content' : 'inner-page'}`}>
        {view === 'workspace' && <AnalysisTemplates datasets={data.datasets} onSelect={(goal, id) => onNew(goal, id)} />}
        {view === 'workspace' && onboarding.visible && <OnboardingChecklist progress={onboarding.progress} hasSample={Boolean(sampleReport)} onSample={showSampleReport} onData={() => setView('datasets')} onCreate={() => onNew('', data.datasets.find(dataset => dataset.source === 'upload')?.id || data.datasets[0]?.id)} dismiss={onboarding.dismiss} />}
        {view === 'workspace' && <Workspace tasks={data.tasks} onContinue={onContinue} onSelectSource={source => selectTask(source, true)} task={task} dataset={currentDataset} onNew={goal => onNew(goal, task?.datasetId)} onShowData={showData} full={fullReport} setFull={setFullReport} onSampleGuide={() => { setHelpSection('collaboration'); setHelpOpen(true); }} />}
        {view === 'datasets' && <DataPage datasets={data.datasets} tasks={data.tasks} onSampleReport={showSampleReport} hasSampleReport={Boolean(sampleReport)} onUploaded={onDataset} onPreview={showData} onAnalyze={d => onNew('', d.id)} onRemoved={id => setData(prev => prev ? { ...prev, datasets: prev.datasets.filter(d => d.id !== id) } : prev)} notify={notify} />}
        {view === 'reports' && <ReportsPage metadata={reportMetadata} notify={notify} onContinue={onContinue} tasks={data.tasks} onSelect={t => selectTask(t, true)} onNew={() => onNew()} />}
        {view === 'skills' && <SkillsPage skills={data.skills} onSelect={setSkill} />}
        {view === 'wallet' && <WalletPage wallet={data.wallet} notify={notify} />}
      </main>
    </div>
    {view === 'workspace' && <><button className="mobile-agent-toggle button primary" onClick={() => setPanelOpen(!panelOpen)}><Sparkles size={16} />{task?.status === 'awaiting_approval' ? '需要你的确认' : 'AI 工作动态'}<PanelRight size={15} /></button>{panelOpen && <button className="run-panel-shade" aria-label="关闭 AI 动态" onClick={() => setPanelOpen(false)} />}<RunPanel connection={monitor.connection} notificationPermission={monitor.permission} onEnableNotifications={monitor.enableNotifications} dataset={currentDataset} onNotice={message => notify(message)} onSettings={() => setSettingsOpen(true)} onRetryCreated={(next, wallet, walletVersion) => { onUpdate(next, wallet, walletVersion); selectTask(next); notify("已创建恢复尝试，重新冻结 20 额度。"); }} task={task} settings={data.settings} wallet={data.wallet} open={panelOpen} close={() => setPanelOpen(false)} onUpdate={onUpdate} onError={m => notify(m, true)} onNew={goal => onNew(goal, task?.datasetId)} /></>}
    {newDraft && <NewAnalysis sourceTask={newDraft.source} initialContext={newDraft.context} datasets={data.datasets} defaultMode={mode} initialMode={newDraft.mode} onModeChange={setMode} settings={data.settings} wallet={data.wallet} initialGoal={newDraft.goal} initialDatasetId={newDraft.datasetId} close={closeNew} onDataset={onDataset} onCreated={(next, wallet, walletVersion) => { onUpdate(next, wallet, walletVersion); selectTask(next); setPanelOpen(window.matchMedia('(max-width: 1050px)').matches); notify(`${next.mode === 'collaborative' ? '协作' : '自动'}分析已开始，已冻结 20 服务额度。`); }} onSettings={() => { closeNew(); setSettingsOpen(true); }} />}
    {appearanceOpen && <AppearanceSettings close={closeAppearance} />}
    {settingsOpen && <SettingsModal settings={data.settings} close={closeSettings} onSaved={onSettingsSaved} notify={notify} />}
    {commandOpen && <CommandPalette commands={commands} close={closeCommands} />}
    {shortcutsOpen && <ShortcutHelp close={closeShortcuts} />}
    {accountOpen && cloud && <AccountModal close={closeAccount} />}
    {preview && <DataPreview dataset={preview} close={closePreview} onAnalyze={() => { onNew('', preview.id); closePreview(); }} />}
    {domainOpen && <DomainModal domains={data.domains} close={closeDomain} />}
    {helpOpen && <HelpModal onShortcuts={() => { closeHelp(); setShortcutsOpen(true); }} close={closeHelp} section={helpSection} canStart={access.canStart} onReviewOnboarding={() => { closeHelp(); setView('workspace'); onboarding.reopen(); }} onStartCollaborative={() => { closeHelp(); onNew('', task?.datasetId || sampleReport?.datasetId, 'collaborative'); }} />}
    {skill && <SkillModal skill={skill} close={closeSkill} />}
    {toast && <Toast message={toast.text} error={toast.error} close={() => setToast(null)} />}
  </div>;
}
