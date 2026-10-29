import type { Task } from './types';
export interface DesktopSummary { id: string; title: string; status: 'running' | 'awaiting_approval' }
export interface DesktopBridge {
  setTheme?: (theme: 'light' | 'dark' | 'system') => unknown;
  onSystemThemeChanged?: (callback: (dark: boolean) => void) => unknown;
  setTaskSummaries?: (summaries: DesktopSummary[]) => unknown;
  onNewAnalysis?: (callback: () => void) => unknown;
  setTrayState?: (state: 'login' | 'ready') => unknown;
  showWindow?: () => unknown;
}
declare global { interface Window { dataagentDesktop?: DesktopBridge } }
export function taskSummaries(tasks: Task[]): DesktopSummary[] {
  return tasks.filter((task): task is Task & { status: DesktopSummary['status'] } => (task.status === 'running' || task.status === 'awaiting_approval') && typeof task.id === 'string' && !!task.id.trim() && task.id.length <= 128 && typeof task.title === 'string' && !!task.title.trim()).slice(0, 20).map(task => ({ id: task.id, title: task.title.slice(0, 120), status: task.status }));
}

// Old clients may expose only some methods. Treat the bridge as optional UI assistance.
function settle(value: unknown) { void Promise.resolve(value).catch(() => {}); }
export function setDesktopState(bridge: DesktopBridge | undefined, state: 'login' | 'ready') {
  try { if (typeof bridge?.setTrayState === 'function') settle(bridge.setTrayState(state)); } catch {}
}
export function setDesktopSummaries(bridge: DesktopBridge | undefined, summaries: DesktopSummary[]) {
  try { if (typeof bridge?.setTaskSummaries === 'function') settle(bridge.setTaskSummaries(summaries)); } catch {}
}
export function showDesktopWindow(bridge: DesktopBridge | undefined) {
  try { if (typeof bridge?.showWindow === 'function') settle(bridge.showWindow()); } catch {}
}
export function subscribeDesktopNew(bridge: DesktopBridge | undefined, callback: () => void): () => void {
  try {
    if (typeof bridge?.onNewAnalysis !== 'function') return () => {};
    const unsubscribe = bridge.onNewAnalysis(callback);
    if (typeof unsubscribe === 'function') return () => { try { settle(unsubscribe()); } catch {} };
    settle(unsubscribe);
  } catch {}
  return () => {};
}
