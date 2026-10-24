import type { Bootstrap, Dataset, Mode, Runtime, Settings, Task, Transaction, User, Wallet } from './types';

const sessionExpiredListeners = new Set<() => void>();
let sessionBoundary = 0;
export function onSessionExpired(listener: () => void) { sessionExpiredListeners.add(listener); return () => { sessionExpiredListeners.delete(listener); }; }
export function resetSessionBoundary() { sessionBoundary++; }

async function request<T>(path: string, options: RequestInit = {}, authentication = false, format: 'json' | 'text' = 'json'): Promise<T> {
  const boundary = sessionBoundary;
  const headers = options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers };
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' }); }
  catch { throw new Error('无法连接分析服务，请检查网络和服务地址后重试。'); }
  if (!response.ok) {
    if (response.status === 401 && !authentication && boundary === sessionBoundary) sessionExpiredListeners.forEach(listener => listener());
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `请求失败（${response.status}），请重试。`);
  }
  return (format === 'text' ? response.text() : response.json()) as Promise<T>;
}
export const api = {
  runtime: () => request<Runtime>('/runtime', {}, true),
  session: () => request<{ user: User | null }>('/auth/session', {}, true),
  register: (input: { username: string; displayName: string; password: string }) => request<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify(input) }, true),
  login: (input: { username: string; password: string }) => request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(input) }, true),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST', body: '{}' }, true),
  changePassword: (input: { currentPassword: string; newPassword: string }) => request<{ ok: boolean }>('/auth/change-password', { method: 'POST', body: JSON.stringify(input) }, true),
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  demo: () => request<{ dataset: Dataset }>('/datasets/demo', { method: 'POST', body: '{}' }),
  upload: (files: File[]) => { const body = new FormData(); files.forEach(file => body.append('files', file)); return request<{ dataset: Dataset }>('/datasets/upload', { method: 'POST', body }); },
  removeDataset: (id: string) => request<{ ok: boolean }>(`/datasets/${id}`, { method: 'DELETE' }),
  create: (input: { title: string; goal: string; mode: Mode; datasetId: string; domain: string; useAI: boolean }) => request<{ task: Task; wallet: Wallet }>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
  task: (id: string) => request<{ task: Task; wallet: Wallet }>(`/tasks/${id}`),
  report: (id: string) => request<string>(`/tasks/${encodeURIComponent(id)}/report.md`, {}, false, 'text'),
  approve: (id: string, message?: string, stepId?: string) => request<{ task: Task; wallet: Wallet }>(`/tasks/${id}/approve`, { method: 'POST', body: JSON.stringify({ message, stepId }) }),
  message: (id: string, message: string) => request<{ task: Task }>(`/tasks/${id}/message`, { method: 'POST', body: JSON.stringify({ message }) }),
  cancel: (id: string) => request<{ task: Task; wallet: Wallet }>(`/tasks/${id}/cancel`, { method: 'POST', body: '{}' }),
  wallet: () => request<{ wallet: Wallet; transactions: Transaction[] }>('/wallet'),
  settings: (input: Partial<Settings> & { apiKey?: string; clearKey?: boolean }) => request<{ settings: Settings }>('/settings', { method: 'PUT', body: JSON.stringify(input) }),
  testSettings: () => request<{ ok: boolean; message: string }>('/settings/test', { method: 'POST', body: '{}' }),
};
