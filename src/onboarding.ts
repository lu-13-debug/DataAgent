import type { Dataset, Runtime, Task, User } from './types';

export interface OnboardingProgress { viewedSample: boolean; selectedData: boolean; generatedReport: boolean; dismissed: boolean }
const fields = ['viewedSample', 'selectedData', 'generatedReport', 'dismissed'] as const;
const clean = (value: unknown): OnboardingProgress => Object.fromEntries(fields.map(field => [field, Boolean(value && typeof value === 'object' && (value as Record<string, unknown>)[field] === true)])) as unknown as OnboardingProgress;

export function onboardingKey(runtime: Pick<Runtime, 'mode'>, user: Pick<User, 'id'> | null, origin: string) {
  return `dataagent:onboarding:v1:${runtime.mode}:${encodeURIComponent(origin)}:${runtime.mode === 'cloud' ? encodeURIComponent(user?.id || 'anonymous') : 'local'}`;
}
export function readOnboarding(storage: Pick<Storage, 'getItem'>, key: string): OnboardingProgress {
  try { return clean(JSON.parse(storage.getItem(key) || '{}')); } catch { return clean(null); }
}
export function writeOnboarding(storage: Pick<Storage, 'setItem'>, key: string, value: unknown) {
  try { storage.setItem(key, JSON.stringify(clean(value))); } catch { /* 存储不可用时仍允许完成当前会话的引导。 */ }
}
export function isPresetSample(task: Pick<Task, 'events'>) {
  // 同一示例数据的新建分析仍收费；只有预置历史具有此事件。
  return task.events.some(event => event.type === 'info' && event.title === '示例报告已生成');
}
export function progressFromData(progress: OnboardingProgress, datasets: Pick<Dataset, 'source'>[], tasks: Pick<Task, 'status' | 'events' | 'report'>[]): OnboardingProgress {
  return { ...progress, selectedData: progress.selectedData || datasets.some(dataset => dataset.source === 'upload'), generatedReport: progress.generatedReport || tasks.some(task => task.status === 'completed' && Boolean(task.report) && !isPresetSample(task)) };
}
export function onboardingComplete(progress: Pick<OnboardingProgress, 'viewedSample' | 'selectedData' | 'generatedReport'>) {
  return progress.viewedSample && progress.selectedData && progress.generatedReport;
}
