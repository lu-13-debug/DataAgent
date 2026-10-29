import { useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth-context';
import { analysisAccess } from '../product-state';
import { Modal, Spinner } from './ui';
import type { Mode, Settings, Task, Wallet } from '../types';
const optional = [{ id: 'retention', name: '留存分析' }, { id: 'monetization', name: '商业化分析' }, { id: 'insights', name: '洞察与建议' }];
export function RetryTaskModal({ task, settings, wallet, strategy: initialStrategy, useAI: initialAI, close, onCreated }: {
  task: Task; settings: Settings; wallet: Wallet; strategy: 'restart' | 'resume'; useAI?: boolean; close: () => void; onCreated: (task: Task, wallet: Wallet, walletVersion?: number) => void;
}) {
  const { runtime } = useAuth(); const access = analysisAccess(runtime, settings, wallet);
  const [strategy, setStrategy] = useState(initialStrategy); const [mode, setMode] = useState<Mode>(task.mode); const [useAI, setUseAI] = useState((initialAI ?? task.useAI) && access.canUseAI); const [skips, setSkips] = useState(task.skippedSteps || []);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const requestId = useRef(crypto.randomUUID()); const pending = useRef(false);
  async function create() {
    if (pending.current || !access.canStart) return; pending.current = true; setBusy(true); setError('');
    try { const result = await api.retry(task.id, { strategy, mode, useAI: useAI && access.canUseAI, skipSteps: skips, clientRequestId: requestId.current }); onCreated(result.task, result.wallet, result.walletVersion); close(); }
    catch (failure) { setError((failure as Error).message); pending.current = false; }
    finally { setBusy(false); }
  }
  return <Modal title="确认创建恢复尝试" subtitle="原任务和失败记录保留，来源会记录到新任务。" close={close} wide dismissible={!busy}><div className="modal-body retry-task-form"><p>来源：{task.title}</p><p>将沿用原数据、目标与业务背景。选择恢复时会复用已完成的确定性步骤，必要的指标核验仍会重算；模型报告会重新生成。</p><label className="field">执行策略<select aria-label="执行策略" disabled={busy} value={strategy} onChange={event => setStrategy(event.target.value as 'resume' | 'restart')}><option value="resume">从失败位置恢复，复用已完成的确定性步骤</option><option value="restart">基于相同设置从头重新运行</option></select></label><label className="field">工作方式<select aria-label="工作方式" disabled={busy} value={mode} onChange={event => setMode(event.target.value as Mode)}><option value="collaborative">协作模式，未完成的确认节点仍需批准</option><option value="automatic">自动模式，中途无需批准</option></select></label><label className="confirm-recognition"><input type="checkbox" disabled={busy || !access.canUseAI} checked={useAI} onChange={event => setUseAI(event.target.checked)} />{useAI ? `启用 AI · 当前模型 ${settings.model}` : '仅确定性分析，不调用模型'}</label>{!access.canUseAI && <p>{access.modelDescription}</p>}{useAI && <p>将发送目标、业务背景与聚合指标，不发送原始玩家 ID 明细；请检查背景自由文本。会使用当前会话的模型配置，模型费用另计。</p>}<fieldset disabled={busy} className="optional-branches"><legend>可选：跳过部分分析分支</legend>{optional.map(item => <label className="confirm-recognition" key={item.id}><input type="checkbox" checked={skips.includes(item.id)} onChange={event => setSkips(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} />跳过{item.name}，相关结果不进入报告或模型输入</label>)}</fieldset><p className="quota-notice">本次创建新任务，重新冻结 20 额度；模型费用与服务额度独立。失败或取消释放服务额度。</p>{!access.canStart && <p role="alert">额度不足，当前可用 {wallet.balance}，需要 20 额度。</p>}{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><button className="button secondary" disabled={busy} onClick={close}>返回原任务</button><button className="button primary" disabled={busy || !access.canStart} onClick={() => void create()}>{busy && <Spinner size={14} />}确认新建恢复尝试 · 20 额度</button></div></Modal>;
}
