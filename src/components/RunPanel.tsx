import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Check, CheckCheck, ChevronDown, ChevronRight, Clock3, Cpu, FileCheck2, GitBranch, MessageSquare, Pause, Play, Sparkles, Square, X } from 'lucide-react';
import type { Dataset, Settings, Task, Wallet } from '../types';
import { api } from '../api';
import { useAuth } from '../auth-context';
import { analysisAccess } from '../product-state';
import { Logo, Spinner } from './ui';
import { ExecutionPlan } from './ExecutionPlan';
import { useTaskActions } from '../use-task-actions';
import { modelDiagnosis } from '../model-profiles';

export function RunPanel({ task, open, close, onUpdate, onError, onNew, settings, wallet, dataset, connection, notificationPermission, onEnableNotifications, onRetryCreated, onSettings, onNotice }: { task?: Task; dataset?: Dataset; connection: 'connecting' | 'connected' | 'reconnecting'; notificationPermission: NotificationPermission | 'unsupported'; onEnableNotifications: () => Promise<void>; onRetryCreated: (task: Task, wallet: Wallet, walletVersion?: number) => void; onSettings: () => void; onNotice: (text: string) => void; settings: Settings; wallet: Wallet; open: boolean; close: () => void; onUpdate: (task: Task, wallet?: Wallet, walletVersion?: number) => void; onError: (message: string) => void; onNew: (goal?: string) => void }) {
  const { runtime } = useAuth();
  const cloud = runtime.mode === 'cloud';
  const access = analysisAccess(runtime, settings, wallet);
  const [tab, setTab] = useState<'activity' | 'chat'>('activity'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [expanded, setExpanded] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (tab === 'chat') scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [task?.messages.length, tab]);
  const running = task?.status === 'running'; const waiting = task?.status === 'awaiting_approval';
  const finished = task?.status === 'completed'; const canInteract = running || waiting;
  const reportLocked = Boolean(task?.useAI && task?.steps.find(s => s.id === 'report')?.status === 'running');
  async function approve() {
    if (!task) return; setBusy(true);
    try { const result = await api.approve(task.id, message || undefined, activeStep?.id); setMessage(''); onUpdate(result.task, result.wallet, result.walletVersion); }
    catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  async function send() {
    if (!message.trim() || !task) return;
    if (!canInteract) { onNew(message.trim()); setMessage(''); return; }
    setBusy(true);
    try { const result = await api.message(task.id, message.trim()); setMessage(''); onUpdate(result.task); setTab('chat'); }
    catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  const actions = useTaskActions({ task, settings, wallet, onUpdate, onCreated: onRetryCreated, onNotice });
  const total = task?.steps.length || 8; const completed = task?.steps.filter(s => s.status === 'completed' || (task.status !== 'cancelled' && s.status === 'skipped')).length || 0;
  const activeStep = task?.steps.find(s => s.status === 'running' || s.status === 'awaiting_approval');
  return <><aside className={`run-panel ${open ? 'run-panel-open' : ''}`} aria-label="AI 工作动态">
    <div className="run-panel-heading"><span className="agent-identity"><Logo small /><strong>AI 分析搭档</strong></span><span className={`agent-status ${running ? 'working' : ''}`}><span />{running ? '工作中' : waiting ? '等你确认' : task?.status === 'failed' ? '未完成' : task?.status === 'cancelled' ? '已停止' : '就绪'}</span><button className="icon-button mobile-panel-close" onClick={close} aria-label="关闭 AI 动态"><X size={17} /></button></div>
    <div className="agent-intro"><span className="agent-mini-label">一起把问题看得更清楚</span><p>{task?.useAI ? `使用 ${task.model || '已配置模型'} 解读，计算结果由分析引擎提供。` : task ? '本次使用确定性分析引擎计算指标并生成规则解读。' : access.modelDescription}</p><span className="agent-mode"><GitBranch size={12} />{task ? task.mode === 'automatic' ? '自动模式' : '协作模式' : '待开始'}<i />{task?.useAI ? '自带 API Key' : cloud ? '确定性分析' : '本地分析'}</span></div>
    <div className="panel-tabs" role="tablist" aria-label="AI 面板视图"><button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'selected' : ''} onClick={() => setTab('activity')}><Cpu size={14} />执行动态</button><button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'selected' : ''} onClick={() => setTab('chat')}><MessageSquare size={14} />协作对话{Boolean(task?.messages.filter(m => m.role === 'user').length) && <span>{task?.messages.filter(m => m.role === 'user').length}</span>}</button></div>
    <div className="run-scroll" ref={scrollRef}>
      <div className="task-notification-settings"><span>{connection === 'reconnecting' ? '连接中断，正在重连；已有状态保留。' : '执行状态已同步'}</span>{notificationPermission === 'default' ? <button className="text-button" onClick={() => void onEnableNotifications()}>开启任务完成通知</button> : <small>{notificationPermission === 'granted' ? '系统通知已开启' : '通知不可用，将使用标题栏提示'}</small>}</div>
      {actions.feedback && <p className="released-credit" role="status">{actions.feedback}</p>}
      {task?.sourceTaskId && <p className="task-source-note">恢复来源：{task.sourceTaskId}</p>}
      {task?.status === 'awaiting_approval' && <ExecutionPlan task={task} dataset={dataset} canSkip={Boolean(runtime.capabilities?.taskSkip)} onSkip={actions.skip} />}
      {task && ['failed', 'cancelled'].includes(task.status) && <section className="task-failure-actions"><h3>{task.status === 'failed' ? '分析未完成，可以创建新尝试' : '分析已停止'}</h3><p role={task.status === 'failed' ? 'alert' : undefined}>{task.error || (task.status === 'failed' ? '正在同步失败原因，冻结额度已释放。' : '任务已取消，冻结额度已释放。')}</p>{task.status === 'failed' && <p>{task.useAI ? modelDiagnosis({ code: task.errorCode }).action : '请核对数据字段、完整自然日覆盖与质量提示；修复后新建分析。'}</p>}{runtime.capabilities?.taskRecovery ? <><p>以下操作会创建新任务并重新冻结 20 额度，原任务保留。</p><button className="button secondary" onClick={() => actions.retry('resume')}>从失败步骤恢复</button><button className="text-button" onClick={() => actions.retry('restart')}>基于相同设置重新运行</button><button className="text-button" onClick={() => actions.retry('restart', false)}>仅确定性分析重跑</button><button className="text-button" onClick={() => { onNotice('保存模型后返回这里确认恢复，新尝试使用当前模型配置。'); onSettings(); }}>选择模型，再确认重跑</button></> : <button className="button secondary" onClick={() => onNew(task.goal)}>新建分析，预填目标与数据</button>}</section>}
      {!task ? <div className="agent-empty"><Sparkles size={23} /><p>准备好开始了</p><small>创建一次分析，在这里跟进每一步。</small></div> : tab === 'activity' ? <>
        <div role="status" aria-live="polite" className={`run-status-card ${waiting ? 'waiting' : ''} ${task.status === 'failed' ? 'failed' : ''}`}><span className="run-status-icon">{running ? <Spinner size={18} /> : waiting ? <Pause size={17} /> : finished ? <CheckCheck size={19} /> : <Square size={16} />}</span><div><strong>{running ? activeStep?.name || '正在分析数据' : waiting ? '下一步，需要你的确认' : finished ? '分析完成，报告已就绪' : task.status === 'failed' ? '本次分析未完成' : '已停止本次分析'}</strong><p>{running ? '正在执行已选工作流' : waiting ? '确认范围后，继续后续分析' : finished ? `${completed} 个步骤完成 · 结果已保存` : task.error || '冻结额度已释放'}</p></div></div>
        <div className="run-progress"><div><span>分析进度</span><strong>{completed}<small> / {total}</small></strong></div><div className="progress-track" role="progressbar" aria-label="分析进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress}><i style={{ width: `${task.progress}%` }} /></div></div>
        <div className="steps-timeline">{task.steps.map((step, index) => {
          const done = step.status === 'completed' || step.status === 'skipped'; const active = step.status === 'running'; const pending = step.status === 'awaiting_approval'; const failed = step.status === 'failed';
          return <div className={`timeline-step ${step.status}`} key={step.id}><span className="step-indicator">{done ? <Check size={12} /> : active ? <Spinner size={12} /> : pending ? <Pause size={11} /> : failed ? <X size={12} /> : <span>{index + 1}</span>}</span><button className="step-content" onClick={() => setExpanded(expanded === step.id ? null : step.id)} aria-expanded={expanded === step.id}><span className="step-title">{step.name}<span>{active ? '进行中' : pending ? '待确认' : step.status === 'skipped' ? '已跳过' : done ? <Check size={11} /> : <ChevronRight size={12} />}</span></span><span className="step-description">{step.status === 'failed' ? task.error || step.summary || step.description : step.summary || step.description}</span>{expanded === step.id && <span className="step-expanded"><span>调用能力：{step.skillId || step.id}</span>{task.events.filter(e => e.stepId === step.id).map(event => <span key={event.id}>{event.detail}</span>)}</span>}</button></div>;
        })}</div>
        {finished && <div className="agent-completion-note"><FileCheck2 size={17} /><div><strong>你的数据，已经有了故事。</strong><p>查看报告中的发现和建议，继续提出想探索的问题。</p></div></div>}
        {task.events.length > 0 && <details className="event-log"><summary>查看执行记录 <ChevronDown size={12} /></summary>{task.events.slice(-12).map(event => <div key={event.id}><time>{new Date(event.createdAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>{event.title}</span><small>{event.detail}</small></div>)}</details>}
      </> : <div className="chat-messages"><div className="chat-notice"><ShieldLabel />这里只展示工作状态、上下文和结果摘要。</div>{task.messages.map(m => <div key={m.id} className={`chat-message ${m.role}`}><span className="chat-role">{m.role === 'user' ? '你' : m.role === 'system' ? '工作流' : task.useAI ? 'AI 分析搭档' : '分析搭档'}</span><p>{m.content}</p><time>{new Date(m.createdAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}</time></div>)}{!task.messages.length && <div className="agent-empty"><MessageSquare size={22} /><p>给分析多一点业务背景</p><small>例如版本更新时间、运营活动或你特别关注的渠道。</small></div>}</div>}
    </div>
    <div className="agent-composer">{waiting && <div className="approval-actions"><p><Pause size={12} />{activeStep?.id === 'report' ? '分析结果已整理，确认后生成报告。' : '请确认分析范围，或先补充业务背景。'}</p><button className="button primary full-width" onClick={approve} disabled={busy}>{busy ? <Spinner size={14} /> : <Play size={13} />}确认并继续<ArrowRight size={14} /></button></div>}<form onSubmit={e => { e.preventDefault(); void send(); }}><textarea aria-label="发送给分析搭档的消息" disabled={reportLocked} placeholder={reportLocked ? '模型正在生成报告，新增背景可用于下次分析…' : canInteract ? '补充背景，或告诉我你关注什么…' : '还有什么想从数据中了解的？'} value={message} maxLength={3000} rows={2} onChange={e => setMessage(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><div className="composer-bottom"><span><Sparkles size={12} />{reportLocked ? '当前模型请求已发出' : canInteract ? '业务上下文会用于后续解读' : '继续提问将创建新的分析'}</span><button className="send-button" type="submit" disabled={!message.trim() || busy || reportLocked} aria-label="发送消息">{busy ? <Spinner size={14} /> : <ArrowUp size={15} />}</button></div></form><div className="composer-footnote">{canInteract ? <><span><Clock3 size={11} />已冻结 {task?.cost || 20} 额度</span><button onClick={actions.cancel} disabled={busy || actions.pending}><Square size={10} />停止分析</button></> : <span><Check size={11} />{finished ? '本次分析已保存' : '准备好，随时开始'}</span>}</div></div>
  </aside>{actions.dialog}</>;
}
function ShieldLabel() { return <span className="online-dot" />; }
