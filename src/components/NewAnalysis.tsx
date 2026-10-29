import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, MessageSquare, Sparkles, Zap } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth-context';
import { analysisAccess } from '../product-state';
import { choiceKey, goalAdvice, readChoices, resolveChoices, saveChoices, suggestTitle } from '../analysis-draft';
import { DatasetInspection } from './DatasetInspection';
import { UploadControl } from './UploadControl';
import { Checked, Modal, Spinner } from './ui';
import type { Dataset, Mode, Settings, Task, Wallet } from '../types';

export interface NewAnalysisProps {
  datasets: Dataset[]; defaultMode: Mode; initialMode?: Mode; settings: Settings; initialGoal: string; initialDatasetId?: string; wallet: Wallet;
  close: () => void; onCreated: (task: Task, wallet: Wallet, walletVersion?: number) => void; onDataset: (dataset: Dataset) => void; onSettings: () => void;
  onModeChange?: (mode: Mode) => void; sourceTask?: Task; initialContext?: string;
}
const steps = ['数据', '问题', '方式与成本', '摘要确认'];
export function NewAnalysis({ datasets, defaultMode, initialMode, settings, initialGoal, initialDatasetId, wallet, close, onCreated, onDataset, onSettings, onModeChange, sourceTask, initialContext = '' }: NewAnalysisProps) {
  const { runtime, user } = useAuth(); const access = analysisAccess(runtime, settings, wallet);
  const preserveSource = runtime.capabilities?.reportContinuation === true;
  const preferenceKey = choiceKey(runtime.mode, user?.id, window.location.origin);
  const [initial] = useState(() => {
    let stored = {}; try { stored = readChoices(localStorage, preferenceKey); } catch { /* 浏览器禁用存储时保留当前选择。 */ }
    return resolveChoices(stored, datasets, access.canUseAI, { mode: initialMode || defaultMode, ...(initialDatasetId ? { datasetId: initialDatasetId } : {}) });
  });
  const [step, setStep] = useState(0); const [datasetId, setDatasetId] = useState(initial.datasetId); const [mode, setMode] = useState<Mode>(initial.mode); const [useAI, setUseAI] = useState(initial.useAI);
  const [goal, setGoal] = useState(initialGoal || '分析当前数据覆盖期间的活跃、留存与付费表现，比较值得关注的变化并给出运营建议。'); const [context, setContext] = useState(initialContext); const [title, setTitle] = useState(''); const [editedTitle, setEditedTitle] = useState(false);
  const [inheritContext, setInheritContext] = useState(true); const sourceMessages = sourceTask?.messages.filter(message => message.role === 'user') || [];
  const [confirmedId, setConfirmedId] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const submitted = useRef(false); const heading = useRef<HTMLHeadingElement>(null);
  const [uploading, setUploading] = useState(false);
  const clientRequestId = useRef(crypto.randomUUID());
  const dataset = datasets.find(item => item.id === datasetId); const actualTitle = editedTitle ? title : suggestTitle(goal, dataset?.dateRange); const advice = goalAdvice(goal);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => { try { saveChoices(localStorage, preferenceKey, { mode, datasetId, useAI }); } catch { /* 仅保存非敏感选择，存储禁用不影响分析。 */ } onModeChange?.(mode); }, [mode, datasetId, useAI, preferenceKey, onModeChange]);
  const canNext = step === 0 ? Boolean(!uploading && dataset && confirmedId === datasetId && dataset.inspection?.analyzable !== false) : step === 1 ? Boolean(goal.trim() && actualTitle.trim()) : access.canStart;
  function advance() { if (step < 3 && canNext) { setError(''); setStep(step + 1); } }
  async function create() {
    if (submitted.current || busy) return;
    if (!access.canStart || !dataset || dataset.inspection?.analyzable === false || confirmedId !== datasetId || !goal.trim() || !actualTitle.trim()) { setError('请核对数据识别结果、分析目标、标题与可用额度。'); return; }
    submitted.current = true; setBusy(true); setError('');
    try {
      const result = await api.create({ title: actualTitle.trim(), goal: `${goal.trim()}${context.trim() ? `\n业务背景：${context.trim()}` : ''}`, mode, datasetId, domain: 'game', useAI: useAI && access.canUseAI, clientRequestId: clientRequestId.current, ...(sourceTask && runtime.capabilities?.reportContinuation === true ? { sourceTaskId: sourceTask.id, inheritContext } : {}) });
      onCreated(result.task, result.wallet, result.walletVersion); close();
    } catch (failure) { setError((failure as Error).message); submitted.current = false; }
    finally { setBusy(false); }
  }
  return <Modal title="开始一次新的分析" subtitle="先核对数据，再明确问题、方式和成本。" close={close} wide dismissible={!busy}>
    <div className="modal-body analysis-wizard" onKeyDown={event => {
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || step === 3) return;
      const target = event.target as HTMLElement;
      if (['TEXTAREA', 'INPUT', 'H2'].includes(target.tagName) && !(target instanceof HTMLInputElement && ['checkbox', 'file'].includes(target.type))) { event.preventDefault(); advance(); }
    }}>
      <ol className="wizard-steps" aria-label="新建分析步骤">{steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} className={index === step ? 'current' : index < step ? 'done' : ''}><span>{index < step ? <Check size={12} /> : index + 1}</span>{label}</li>)}</ol>
      <h2 ref={heading} tabIndex={-1} className="wizard-title">{steps[step]}{step < 3 ? ` · 第 ${step + 1} 步` : ' · 最后核对'}</h2>
      {sourceTask && <aside className="continuation-source" role="note"><strong>{preserveSource ? `基于「${sourceTask.title}」继续` : `预填来自「${sourceTask.title}」`}</strong><p>{preserveSource ? '将创建一份新分析，来源报告保留；确认后重新冻结 20 服务额度。' : '当前服务只预填目标、数据源与表单背景，不记录来源链路，也不沿用追加的协作消息。检查后可创建普通新任务，确认后冻结 20 额度。'}</p>{datasetId !== sourceTask.datasetId && <p>当前数据源与来源不同，请核对业务背景是否仍然适用。</p>}</aside>}
      {step === 0 && <>
        {initial.corrections.map(message => <p className="quota-notice" key={message}>{message}</p>)}
        <label className="field">选择分析数据<select aria-label="选择分析数据" disabled={uploading} value={datasetId} onChange={event => { setDatasetId(event.target.value); setConfirmedId(''); }}><option value="" disabled>请选择数据</option>{datasets.map(item => <option key={item.id} value={item.id}>{item.name}{item.source === 'demo' ? '（示例）' : ''} · {item.rowCount} 条</option>)}</select></label>
        <UploadControl compact onStart={() => setConfirmedId('')} onBusyChange={setUploading} onSuccess={next => { onDataset(next); setDatasetId(next.id); setConfirmedId(''); }} />
        {dataset ? <><DatasetInspection dataset={dataset} /><label className="confirm-recognition"><input type="checkbox" disabled={uploading} checked={confirmedId === datasetId} onChange={event => setConfirmedId(event.target.checked ? datasetId : '')} />我已核对自动识别结果、时间范围和缺表影响</label></> : <p>请先选择或上传一份数据。</p>}
      </>}
      {step === 1 && <>
        <label className="field">你想了解什么？<textarea aria-label="分析目标" value={goal} onChange={event => setGoal(event.target.value)} rows={4} maxLength={2200} /><small className="field-help">Enter 下一步，Shift+Enter 换行。建议不会阻止创建。</small></label>
        {advice.length > 0 && <aside className="goal-advice" role="note"><strong>让问题更容易分析</strong><ul>{advice.map(item => <li key={item}>{item}</li>)}</ul></aside>}
        <label className="field">业务背景（可选）<textarea aria-label="业务背景" value={context} onChange={event => setContext(event.target.value)} rows={3} maxLength={700} placeholder="例如版本上线日期、运营活动与关注的渠道；请勿填写玩家明细或 API Key。" /></label>
        {sourceMessages.length > 0 && preserveSource && <section className="inherited-context"><label className="confirm-recognition"><input type="checkbox" checked={inheritContext} onChange={event => setInheritContext(event.target.checked)} />沿用来源中的 {sourceMessages.length} 条追加业务背景</label><details><summary>核对来源中追加的背景</summary><ul>{sourceMessages.map(message => <li key={message.id}>{message.content}</li>)}</ul></details><p className="field-help">只沿用你追加的文字，不复制原 AI 解读。请确认其中不含玩家明细或凭据。</p></section>}
        <label className="field">分析名称<input aria-label="分析名称" value={actualTitle} onChange={event => { setEditedTitle(true); setTitle(event.target.value); }} maxLength={80} /></label><div className="title-suggestion"><small className="field-help">{editedTitle ? '已手动编辑，修改目标不会覆盖此标题。' : '根据分析目标与数据期间自动建议，可直接编辑。'}</small>{editedTitle && <button className="text-button" onClick={() => setEditedTitle(false)}>恢复建议标题</button>}</div>
      </>}
      {step === 2 && <>
        <div className="mode-options">{(['collaborative', 'automatic'] as Mode[]).map(value => <button className={`mode-option ${mode === value ? 'selected' : ''}`} aria-pressed={mode === value} key={value} onClick={() => setMode(value)}><span className="mode-option-heading">{value === 'collaborative' ? <MessageSquare size={18} /> : <Zap size={18} />}<Checked value={mode === value} /></span><strong>{value === 'collaborative' ? '协作模式' : '自动模式'}</strong><p>{value === 'collaborative' ? '分析计划与生成报告前，两次等待你确认。' : '确认开始后执行既定流程，中途无需批准。'}</p><p>计算：确定性引擎；AI：{useAI && access.canUseAI ? '已开启辅助解读' : '不调用模型'}。</p><p>产出：完整运营报告、指标表与可导出结果。</p></button>)}</div>
        <div className="wizard-ai card"><div className="inspection-heading"><div><h3>AI 辅助解读</h3><p>{access.modelDescription}</p></div><label className="confirm-recognition"><input type="checkbox" checked={useAI && access.canUseAI} disabled={!access.canUseAI} onChange={event => setUseAI(event.target.checked)} />{useAI && access.canUseAI ? '当前启用 AI' : '当前仅确定性分析'}</label></div>
          {useAI && access.canUseAI ? <><p>当前模型：{settings.model}</p><p>将发送：分析目标、你填写的业务背景、聚合指标、按日趋势、留存 cohort、渠道汇总和质量概况。</p><p>不会发送原始玩家 ID 明细。请检查自由文本中是否包含个人信息。</p><button className="button secondary" onClick={() => setUseAI(false)}>切换为仅确定性分析</button></> : <p>本次不向模型发送内容，完整指标计算与规则报告仍可生成。</p>}
          {!access.canUseAI && <button className="text-button" onClick={onSettings}>前往模型设置（将关闭本次草稿）<ArrowRight size={13} /></button>}
        </div>
        {!access.canStart && <p className="quota-notice" role="note">额度不足，需 20 额度，当前可用 {wallet.balance} 额度。可继续阅读示例报告。</p>}
      </>}
      {step === 3 && <div className="wizard-summary"><h3>{actualTitle}</h3><dl><div><dt>数据源</dt><dd>{dataset?.name}{dataset?.source === 'demo' ? '（示例数据）' : ''}</dd></div><div><dt>数据期间</dt><dd>{dataset?.dateRange?.start?.slice(0, 10)} 至 {dataset?.dateRange?.end?.slice(0, 10)}</dd></div><div><dt>工作方式</dt><dd>{mode === 'collaborative' ? '协作模式 · 两次中途确认' : '自动模式 · 无中途批准'}</dd></div><div><dt>AI 调用</dt><dd>{useAI && access.canUseAI ? `已开启 · ${settings.model}；发送目标、背景和聚合指标，不发送原始玩家明细` : '仅确定性分析，不调用模型'}</dd></div><div><dt>服务成本</dt><dd>冻结 20 额度，完成后结算，失败或取消后释放</dd></div><div><dt>目标</dt><dd>{goal}</dd></div>{context && <div><dt>业务背景</dt><dd>{context}</dd></div>}{sourceTask && <><div><dt>{preserveSource ? "来源报告" : "预填内容来自"}</dt><dd>{sourceTask.title}</dd></div><div><dt>来源追加背景</dt><dd>{preserveSource ? inheritContext ? `沿用 ${sourceMessages.length} 条用户追加背景` : "不沿用来源中追加的背景" : "当前服务不自动沿用追加消息，也不记录来源链路"}</dd></div></>}</dl>{dataset && <DatasetInspection dataset={dataset} showMappings={false} />}<p className="field-help">点击下方确认按钮后才创建任务。使用示例数据重新分析同样冻结 20 额度。</p></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <div className="modal-footer wizard-footer"><div className="wizard-cost" role="note"><strong>本次冻结 20 额度；若启用 AI，模型费用由你的 API Key 承担</strong><span>服务额度与模型 API 费用独立 · 失败或取消释放服务额度</span></div><div className="wizard-navigation">{step > 0 && <button className="button secondary" disabled={busy} onClick={() => { setError(''); setStep(step - 1); }}><ArrowLeft size={14} />上一步</button>}{step < 3 ? <button className="button primary" disabled={!canNext || busy} onClick={advance}>下一步<ArrowRight size={14} /></button> : <button className="button primary" disabled={busy || !access.canStart} onClick={() => void create()}>{busy ? <Spinner size={14} /> : <Sparkles size={14} />}确认并开始分析 · 20 额度</button>}</div></div>
  </Modal>;
}
