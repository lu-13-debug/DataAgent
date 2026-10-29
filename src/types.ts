export type Mode = 'collaborative' | 'automatic';
export type View = 'workspace' | 'datasets' | 'reports' | 'skills' | 'wallet';
export type TaskStatus = 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
export interface User { id: string; username: string; displayName: string; createdAt: string }
export interface Runtime { mode: 'local' | 'cloud'; authRequired: boolean; serviceName: 'DataAgent'; version: string; modelHosts?: string[]; capabilities?: { taskEvents?: boolean; taskSummaries?: boolean; taskRecovery?: boolean; taskSkip?: boolean; idempotentTasks?: boolean; walletVersion?: boolean; reportExplore?: boolean; reportMetadata?: boolean; reportContinuation?: boolean; reportSharing?: boolean } }
export interface Wallet { balance: number; frozen: number; spent: number }
export interface WalletState { wallet: Wallet; walletVersion?: number }
export interface TaskResponse extends WalletState { task: Task }
export interface Settings { provider: string; baseUrl: string; model: string; hasKey: boolean }
export interface ModelOption { id: string; name: string }
export interface ModelCatalog { models: ModelOption[]; baseUrl: string; partial: boolean }
export interface Project { id: string; name: string; domain: string; description: string }
export interface Domain { id: string; name: string; description: string; enabled: boolean }
export interface Skill { id: string; name: string; description: string; category: string; version: string; enabled: boolean }
export interface DataIssue {
  code: string; severity: 'error' | 'warning' | 'info'; problem: string; metrics: string[]; fix: string;
  location?: { table?: string; column?: string; rows?: number[] };
}
export interface DatasetInspection {
  version: 1;
  mappings: { table: string; source: string; field: string; sourceColumn: string | null; origin: 'automatic' | 'generated'; required: boolean }[];
  coverage: { table: string; start: string | null; end: string | null; validRows: number }[];
  missingTables: string[]; issues: DataIssue[]; quality: { score: number | null; rule: string };
  analyzable: boolean; rawRows: number; validRows: number;
}
export interface Dataset {
  id: string; name: string; source: 'demo' | 'upload'; createdAt: string; rowCount: number; tableCount: number;
  tables: { name: string; type: string; columns: string[]; rowCount: number; preview: Record<string, unknown>[] }[];
  warnings: string[]; dateRange: { start: string; end: string }; channelCount: number;
  inspection?: DatasetInspection;
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
  channels: { name: string; users: number | null; revenue: number | null; d1: number | null }[];
  quality: { rows: number; issues: string[]; score: number }; methodology: string[]; source: 'local' | 'ai';
  aiUsage?: { protocol: 'anthropic' | 'chat-completions'; provider: string; model: string; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; cacheReadInputTokens: number | null; cacheCreationInputTokens: number | null; reasoningTokens: number | null };
}
export interface Task {
  id: string; title: string; goal: string; mode: Mode; domain: string; datasetId: string; datasetName: string;
  status: TaskStatus; currentStep: number; progress: number; createdAt: string; updatedAt: string;
  useAI: boolean; model: string; cost: number; steps: Step[]; events: TaskEvent[]; messages: Message[]; report?: Report; error?: string;
  sourceTaskId?: string; sourceKind?: 'continuation'; clientRequestId?: string; skippedSteps?: string[]; errorCode?: string; metadata?: ReportMetadata;
}
export interface ReportMetadata { favorite: boolean; pinned: boolean; tags: string[]; revision: number }
export interface ExploreInput { start: string; end: string; channels?: string[]; comparePrevious?: boolean }
export interface ExploreScope {
  start: string; end: string; channels: string[]; timeZone: 'Asia/Shanghai'; statisticsVersion: string; generatedAt: string;
  coverage: Record<'users' | 'activity' | 'payments', { start: string; end: string } | null>;
  sample: { sourceRows: number; selectedRows: number; selectedRowsByTable: Record<'users' | 'activity' | 'payments', number>; registeredUsers: number | null; payingUsers: number | null };
  skippedSteps: string[];
}
export interface ExploreMetricComparison { id: string; comparable: boolean; reason: string | null; current: number | null; previous: number | null; absoluteChange: number | null; percentChange: number | null }
export interface Exploration {
  report: Report; scope: ExploreScope; previous?: Report; previousScope?: ExploreScope;
  comparison: { requested: boolean; comparable: boolean; reasons: string[]; previousRange?: { start: string; end: string }; metrics: ExploreMetricComparison[] };
}
export type TaskSummary = Pick<Task, 'id' | 'title' | 'mode' | 'domain' | 'datasetId' | 'datasetName' | 'status' | 'currentStep' | 'progress' | 'createdAt' | 'updatedAt' | 'useAI' | 'model' | 'cost' | 'sourceTaskId' | 'sourceKind' | 'skippedSteps' | 'errorCode'> & { steps: Pick<Step, 'id' | 'name' | 'status'>[] };
export interface TaskSnapshot extends WalletState { summaries: TaskSummary[] }
export interface Transaction { id: string; type: 'grant' | 'freeze' | 'settle' | 'release'; amount: number; taskId?: string; description: string; createdAt: string }
export interface Bootstrap extends WalletState { project: Project; tasks: Task[]; datasets: Dataset[]; skills: Skill[]; domains: Domain[]; settings: Settings }

export interface ShareItem { id: string; expiresAt: string; hideRevenue: boolean; revoked: boolean; views: number; registrations: number }
export interface PublicReport { source: 'ai' | 'local'; hideRevenue: boolean; currency?: string | null; period: { start: string; end: string } | null; sample: boolean | null; sampleNotice: string; dailyTruncated: boolean; retentionTruncated: boolean; metrics: { id: string; label: string; value: number | null; unit: string; coverage: {start:string; end:string} | null; method: string | null }[]; daily: {date:string; dau:number|null; newUsers:number|null; revenue?:number|null; payers?:number|null}[]; retention: {date:string; users:number; d1:number|null; d7:number|null}[]; methodology: string[] }
