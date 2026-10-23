import type { Bootstrap, Dataset, Mode, Settings, Task, Transaction, Wallet } from './types';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers };
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, headers }); }
  catch { throw new Error('无法连接本地服务，请确认分析服务正在运行。'); }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `请求失败（${response.status}），请重试。`);
  }
  return response.json();
}
export const api = {
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  demo: () => request<{ dataset: Dataset }>('/datasets/demo', { method: 'POST', body: '{}' }),
  upload: (files: File[]) => { const body = new FormData(); files.forEach(file => body.append('files', file)); return request<{ dataset: Dataset }>('/datasets/upload', { method: 'POST', body }); },
  removeDataset: (id: string) => request<{ ok: boolean }>(`/datasets/${id}`, { method: 'DELETE' }),
  create: (input: { title: string; goal: string; mode: Mode; datasetId: string; domain: string; useAI: boolean }) => request<{ task: Task; wallet: Wallet }>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
  task: (id: string) => request<{ task: Task; wallet: Wallet }>(`/tasks/${id}`),
  approve: (id: string, message?: string, stepId?: string) => request<{ task: Task; wallet: Wallet }>(`/tasks/${id}/approve`, { method: 'POST', body: JSON.stringify({ message, stepId }) }),
  message: (id: string, message: string) => request<{ task: Task }>(`/tasks/${id}/message`, { method: 'POST', body: JSON.stringify({ message }) }),
  cancel: (id: string) => request<{ task: Task; wallet: Wallet }>(`/tasks/${id}/cancel`, { method: 'POST', body: '{}' }),
  wallet: () => request<{ wallet: Wallet; transactions: Transaction[] }>('/wallet'),
  settings: (input: Partial<Settings> & { apiKey?: string; clearKey?: boolean }) => request<{ settings: Settings }>('/settings', { method: 'PUT', body: JSON.stringify(input) }),
  testSettings: () => request<{ ok: boolean; message: string }>('/settings/test', { method: 'POST', body: '{}' }),
};
