import type { Task, TaskStatus, TaskSummary, WalletState } from './types';
import { mergeReportMetadata } from './report-assets.ts';
export function mergeWalletState(current: WalletState, incoming: WalletState): WalletState {
  const valid = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
  const currentVersion = valid(current.walletVersion) ? current.walletVersion : undefined;
  const incomingVersion = valid(incoming.walletVersion) ? incoming.walletVersion : undefined;
  const selected = currentVersion !== undefined && (incomingVersion === undefined || incomingVersion < currentVersion) ? current : incoming;
  return { wallet: selected.wallet, walletVersion: selected.walletVersion };
}
export const isTerminal = (status: TaskStatus) => ['completed', 'failed', 'cancelled'].includes(status);
export function acceptTaskUpdate(current: Pick<Task, 'status' | 'updatedAt'> | undefined, incoming: Pick<Task, 'status' | 'updatedAt'>) {
  if (!current) return true;
  if (isTerminal(current.status) && current.status !== incoming.status) return false;
  return Date.parse(incoming.updatedAt) >= Date.parse(current.updatedAt);
}
export function mergeTaskSummaries(tasks: Task[], summaries: TaskSummary[]): Task[] {
  const result = new Map(tasks.map(task => [task.id, task]));
  for (const summary of summaries) {
    const current = result.get(summary.id); if (!acceptTaskUpdate(current, summary)) continue;
    const steps = summary.steps.map(step => ({ description: '', skillId: step.id, ...current?.steps.find(item => item.id === step.id), ...step }));
    result.set(summary.id, { goal: '', events: [], messages: [], ...current, ...summary, steps });
  }
  return [...result.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export function mergeTaskDetails(tasks: Task[], incoming: Task[]) {
  const result = new Map(tasks.map(task => [task.id, task]));
  for (const task of incoming) {
    const current = result.get(task.id); const metadata = mergeReportMetadata(current?.metadata, task.metadata);
    if (acceptTaskUpdate(current, task)) result.set(task.id, { ...task, ...(metadata ? { metadata } : {}) });
    else if (current && metadata !== current.metadata) result.set(task.id, { ...current, metadata });
  }
  return [...result.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export function createTerminalTracker(tasks: Pick<Task, 'id' | 'status'>[]) {
  const states = new Map(tasks.map(task => [task.id, task.status])); const notified = new Set(tasks.filter(task => isTerminal(task.status)).map(task => task.id));
  return {
    observe(summaries: TaskSummary[]) {
      const finished: TaskSummary[] = [];
      for (const summary of summaries) {
        const previous = states.get(summary.id);
        if (isTerminal(summary.status) && !notified.has(summary.id) && (!previous || !isTerminal(previous))) { notified.add(summary.id); finished.push(summary); }
        if (!previous || !isTerminal(previous)) states.set(summary.id, summary.status);
      }
      return finished;
    },
  };
}
export const connectionExpired = (lastContact: number, now: number, hidden: boolean) => !hidden && now - lastContact > 8000;
