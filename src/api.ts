import type { Bootstrap, PublicReport, ShareItem, Dataset, ExploreInput, Exploration, Mode, ModelCatalog, ReportMetadata, Runtime, Settings, Task, TaskSnapshot, TaskResponse, Transaction, User, Wallet } from './types';
import { uploadFiles } from './upload.ts';
import type { UploadOptions } from './upload';

const sessionExpiredListeners = new Set<() => void>();
let sessionBoundary = 0;
export function onSessionExpired(listener: () => void) { sessionExpiredListeners.add(listener); return () => { sessionExpiredListeners.delete(listener); }; }
export function resetSessionBoundary() { sessionBoundary++; }

async function request<T>(path: string, options: RequestInit = {}, authentication = false, format: 'json' | 'text' = 'json'): Promise<T> {
  const boundary = sessionBoundary;
  const headers = options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers };
  const timeout = AbortSignal.timeout(30000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const connectionFailure = () => {
    if (!signal.aborted) return new Error('无法连接分析服务，请检查网络和服务地址后重试。');
    if (signal.reason?.name !== 'TimeoutError') return new Error('请求已停止，已有服务端任务不会因此取消。');
    return new Error(options.method && options.method !== 'GET' ? '请求超时，服务端可能已处理；请先查看任务状态，再决定是否重试。' : '请求超时，请检查网络和服务地址后重试。');
  };
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, signal, headers, credentials: 'same-origin' }); }
  catch { throw connectionFailure(); }
  if (!response.ok) {
    if (response.status === 401 && !authentication && boundary === sessionBoundary) sessionExpiredListeners.forEach(listener => listener());
    const body = await response.json().catch(() => null);
    throw Object.assign(new Error(body?.error || `请求失败（${response.status}），请重试。`), { code: typeof body?.code === 'string' ? body.code : undefined, status: response.status });
  }
  try { return await (format === 'text' ? response.text() : response.json()) as T; }
  catch { if (signal.aborted) throw connectionFailure(); throw new Error('分析服务返回格式异常，请重新载入；若问题持续，请联系管理员。'); }
}
export const api = {
  readShare: (token: string) => request<{ report: PublicReport }>('/public/shares/read', { method: 'POST', body: JSON.stringify({ token }), referrerPolicy: 'no-referrer', cache: 'no-store' }, true),
  visitShare: (token: string, visitorToken: string) => request<{ ok: boolean }>('/public/shares/visit', { method: 'POST', body: JSON.stringify({ token, visitorToken }), referrerPolicy: 'no-referrer', cache: 'no-store' }, true),
  shares: (id: string) => request<{shares: ShareItem[]}>(`/tasks/${encodeURIComponent(id)}/shares`, {}, true),
  createShare: (id: string, input: {expiresInDays: 1 | 7 | 30; hideRevenue: boolean}) => request<{share: ShareItem; token: string}>(`/tasks/${encodeURIComponent(id)}/shares`, {method:'POST', body:JSON.stringify(input)}, true),
  revokeShare: (id: string) => request<{ok:boolean}>(`/shares/${encodeURIComponent(id)}`, {method:'DELETE'}, true),
  runtime: () => request<Runtime>('/runtime', {}, true),
  session: () => request<{ user: User | null }>('/auth/session', {}, true),
  register: (input: { username: string; displayName: string; password: string; shareToken?: string; visitorToken?: string }) => request<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify(input) }, true),
  login: (input: { username: string; password: string }) => request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(input) }, true),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST', body: '{}' }, true),
  changePassword: (input: { currentPassword: string; newPassword: string }) => request<{ ok: boolean }>('/auth/change-password', { method: 'POST', body: JSON.stringify(input) }, true),
  bootstrap: (signal?: AbortSignal) => request<Bootstrap>('/bootstrap', { signal }),
  health: (signal?: AbortSignal) => request<{ ok: boolean }>('/health', { signal }),
  demo: () => request<{ dataset: Dataset }>('/datasets/demo', { method: 'POST', body: '{}' }),
  upload: (files: File[], options: UploadOptions = {}) => { const boundary = sessionBoundary; return uploadFiles(files, { ...options, onUnauthorized: () => { if (boundary === sessionBoundary) sessionExpiredListeners.forEach(listener => listener()); } }); },
  removeDataset: (id: string) => request<{ ok: boolean }>(`/datasets/${id}`, { method: 'DELETE' }),
  create: (input: { title: string; goal: string; mode: Mode; datasetId: string; domain: string; useAI: boolean; clientRequestId?: string; sourceTaskId?: string; inheritContext?: boolean }) => request<TaskResponse>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
  reportMetadata: (id: string, input: Partial<Pick<ReportMetadata, 'favorite' | 'pinned' | 'tags'>>) => request<{ task: Task }>(`/tasks/${encodeURIComponent(id)}/metadata`, { method: 'PUT', body: JSON.stringify(input) }),
  explore: (id: string, input: ExploreInput, signal?: AbortSignal) => request<Exploration>(`/tasks/${encodeURIComponent(id)}/explore`, { method: 'POST', body: JSON.stringify(input), signal }),
  task: (id: string, signal?: AbortSignal) => request<TaskResponse>(`/tasks/${encodeURIComponent(id)}`, { signal }),
  taskSummaries: (signal?: AbortSignal) => request<TaskSnapshot>('/tasks/summary', { signal }),
  retry: (id: string, input: { strategy: 'restart' | 'resume'; useAI: boolean; mode?: Mode; skipSteps?: string[]; clientRequestId?: string }) => request<TaskResponse>(`/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST', body: JSON.stringify(input) }),
  skip: (id: string, stepId: string) => request<TaskResponse>(`/tasks/${encodeURIComponent(id)}/skip`, { method: 'POST', body: JSON.stringify({ stepId }) }),
  report: (id: string) => request<string>(`/tasks/${encodeURIComponent(id)}/report.md`, {}, false, 'text'),
  approve: (id: string, message?: string, stepId?: string) => request<TaskResponse>(`/tasks/${id}/approve`, { method: 'POST', body: JSON.stringify({ message, stepId }) }),
  message: (id: string, message: string) => request<{ task: Task }>(`/tasks/${id}/message`, { method: 'POST', body: JSON.stringify({ message }) }),
  cancel: (id: string) => request<TaskResponse>(`/tasks/${id}/cancel`, { method: 'POST', body: '{}' }),
  wallet: () => request<{ wallet: Wallet; walletVersion?: number; transactions: Transaction[] }>('/wallet'),
  settings: (input: Partial<Settings> & { apiKey?: string; clearKey?: boolean }) => request<{ settings: Settings }>('/settings', { method: 'PUT', body: JSON.stringify(input) }),
  testSettings: () => request<{ ok: boolean; message: string }>('/settings/test', { method: 'POST', body: '{}' }),
  models: (input: { baseUrl: string; apiKey?: string }, signal?: AbortSignal) => request<ModelCatalog>('/settings/models', { method: 'POST', body: JSON.stringify(input), signal }),
};
