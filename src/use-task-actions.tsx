import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api';
import { Modal, Spinner } from './components/ui';
import { RetryTaskModal } from './components/RetryTaskModal';
import type { Settings, Task, Wallet } from './types';
const names: Record<string, string> = { retention: '留存分析', monetization: '商业化分析', insights: '洞察与建议' };
const impacts: Record<string, string> = { retention: 'D1 / D7、留存表与渠道留存', monetization: '收入、ARPPU、付费人数及相关商业化指标', insights: '发现列表与行动建议' };
interface Options { task?: Task; settings: Settings; wallet: Wallet; onUpdate: (task: Task, wallet?: Wallet, walletVersion?: number) => void; onCreated: (task: Task, wallet: Wallet, walletVersion?: number) => void; onNotice: (text: string) => void }
export function useTaskActions(options: Options) {
  const [confirmation, setConfirmation] = useState<{ task: Task; kind: 'cancel' | 'skip'; stepId?: string } | null>(null);
  const [retry, setRetry] = useState<{ task: Task; strategy: 'restart' | 'resume'; useAI?: boolean } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [feedback, setFeedback] = useState('');
  const close = useCallback(() => { setConfirmation(null); setError(''); }, []); const closeRetry = useCallback(() => setRetry(null), []);
  useEffect(() => { setFeedback(''); }, [options.task?.id]);
  async function execute() {
    if (!confirmation || busy) return; setBusy(true); setError('');
    const action = confirmation;
    try {
      const result = action.kind === 'cancel' ? await api.cancel(action.task.id) : await api.skip(action.task.id, action.stepId!);
      options.onUpdate(result.task, result.wallet, result.walletVersion);
      const message = action.kind === 'cancel' ? ['cancelled', 'failed'].includes(result.task.status) ? `任务已结束，已释放 ${action.task.cost} 额度。` : '任务已完成，服务额度已结算，未释放额度。' : `已跳过${names[action.stepId!] || action.stepId}，相关结果不会纳入报告或模型输入。`;
      setFeedback(message); options.onNotice(message); close();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  const dialog = retry ? <RetryTaskModal task={retry.task} settings={options.settings} wallet={options.wallet} strategy={retry.strategy} useAI={retry.useAI} close={closeRetry} onCreated={options.onCreated} /> : confirmation ? <Modal title={confirmation.kind === 'cancel' ? '确认停止分析' : `确认跳过${names[confirmation.stepId!] || '步骤'}`} subtitle={confirmation.task.title} close={close} dismissible={!busy}><div className="modal-body task-action-confirm"><p>{confirmation.kind === 'cancel' ? `停止后结束当前任务，冻结的 ${confirmation.task.cost} 服务额度会释放。已经发生的模型调用费用由供应商独立结算。` : `跳过后，本次报告和模型输入不包含${impacts[confirmation.stepId!] || '该步骤结果'}。已冻结的服务额度仍按完整任务结算，不额外冻结。`}</p>{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><button className="button secondary" disabled={busy} onClick={close}>返回分析</button><button className="button primary" disabled={busy} onClick={() => void execute()}>{busy && <Spinner size={14} />}{confirmation.kind === 'cancel' ? '确认停止并释放额度' : '确认跳过'}</button></div></Modal> : null;
  return {
    pending: busy, feedback, dialog: dialog ? createPortal(dialog, document.body) : null,
    cancel: () => { if (options.task) { setError(''); setConfirmation({ task: options.task, kind: 'cancel' }); } },
    skip: (stepId: string) => { if (options.task) { setError(''); setConfirmation({ task: options.task, kind: 'skip', stepId }); } },
    retry: (strategy: 'restart' | 'resume', useAI?: boolean) => { if (options.task) setRetry({ task: options.task, strategy, useAI }); },
  };
}
