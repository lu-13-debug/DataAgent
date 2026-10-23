export type Mode = 'collaborative' | 'automatic';
export type View = 'workspace' | 'datasets' | 'reports' | 'skills' | 'wallet';
export type TaskStatus = 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
export interface Wallet { balance: number; frozen: number; spent: number }
export interface Settings { provider: string; baseUrl: string; model: string; hasKey: boolean }
export interface Project { id: string; name: string; domain: string; description: string }
export interface Domain { id: string; name: string; description: string; enabled: boolean }
export interface Skill { id: string; name: string; description: string; category: string; version: string; enabled: boolean }
export interface Dataset {
  id: string; name: string; source: 'demo' | 'upload'; createdAt: string; rowCount: number; tableCount: number;
  tables: { name: string; type: string; columns: string[]; rowCount: number; preview: Record<string, unknown>[] }[];
  warnings: string[]; dateRange: { start: string; end: string }; channelCount: number;
}
export interface Step {
  id: string; name: string; description: string; skillId: string;
  status: 'pending' | 'running' | 'completed' | 'awaiting_approval' | 'skipped' | 'failed'; summary?: string;
}
export interface TaskEvent { id: string; type: 'start' | 'complete' | 'info' | 'approval' | 'error'; title: string; detail: string; stepId?: string; createdAt: string }
export interface Message { id: string; role: 'user' | 'assistant' | 'system'; content: string; createdAt: string }
export interface Metric { id: string; label: string; value: number | null; unit: string; change: number | null; note: string }
export interface Report {
  title: string; period: string; generatedAt: string; currency: string; summary: string;
  findings: { title: string; detail: string; severity: 'positive' | 'warning' | 'neutral'; evidence: string }[];
  recommendations: string[]; metrics: Metric[];
  daily: { date: string; dau: number | null; newUsers: number | null; revenue: number | null; payers: number | null }[];
  retention: { date: string; users: number; d1: number | null; d7: number | null }[];
  channels: { name: string; users: number; revenue: number | null; d1: number | null }[];
  quality: { rows: number; issues: string[]; score: number }; methodology: string[]; source: 'local' | 'ai';
}
export interface Task {
  id: string; title: string; goal: string; mode: Mode; domain: string; datasetId: string; datasetName: string;
  status: TaskStatus; currentStep: number; progress: number; createdAt: string; updatedAt: string;
  useAI: boolean; model: string; cost: number; steps: Step[]; events: TaskEvent[]; messages: Message[]; report?: Report; error?: string;
}
export interface Transaction { id: string; type: 'grant' | 'freeze' | 'settle' | 'release'; amount: number; taskId?: string; description: string; createdAt: string }
export interface Bootstrap { project: Project; tasks: Task[]; datasets: Dataset[]; wallet: Wallet; skills: Skill[]; domains: Domain[]; settings: Settings }
