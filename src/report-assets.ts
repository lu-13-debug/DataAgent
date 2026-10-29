import type { ReportMetadata, Task, TaskStatus } from './types';
export const emptyReportMetadata = (): ReportMetadata => ({ favorite: false, pinned: false, tags: [], revision: 0 });
export function mergeReportMetadata(current: ReportMetadata | undefined, incoming: ReportMetadata | undefined) {
  if (!incoming || (current && incoming.revision < current.revision)) return current;
  return incoming;
}
export function normalizeReportMetadata(value: unknown): ReportMetadata | undefined {
  if (!value || typeof value !== 'object') return;
  const data = value as Record<string, unknown>;
  if (typeof data.favorite !== 'boolean' || typeof data.pinned !== 'boolean' || !Array.isArray(data.tags) || data.tags.length > 8 || data.tags.some(tag => typeof tag !== 'string' || !tag.trim() || [...tag.trim()].length > 20) || !Number.isSafeInteger(data.revision) || (data.revision as number) < 0) return;
  return { favorite: data.favorite, pinned: data.pinned, tags: [...new Set((data.tags as string[]).map(tag => tag.trim()))], revision: data.revision as number };
}
export function metadataStorageKey(runtime: string, userId: string | undefined, origin: string) { return `dataagent:report-metadata:v1:${runtime}:${encodeURIComponent(origin)}:${runtime === 'cloud' ? encodeURIComponent(userId || 'anonymous') : 'local'}`; }
export function readLocalMetadata(storage: Pick<Storage, 'getItem'>, key: string): Record<string, ReportMetadata> {
  try {
    const data = JSON.parse(storage.getItem(key) || '{}'); if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).slice(0, 500).flatMap(([id, value]) => { const metadata = normalizeReportMetadata(value); return /^[\w-]{1,100}$/.test(id) && metadata ? [[id, metadata]] : []; }));
  } catch { return {}; }
}
export function saveLocalMetadata(storage: Pick<Storage, 'setItem'>, key: string, value: Record<string, ReportMetadata>) {
  try { storage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries(value).slice(0, 500).flatMap(([id, item]) => { const metadata = normalizeReportMetadata(item); return /^[\w-]{1,100}$/.test(id) && metadata ? [[id, metadata]] : []; })))); return true; } catch { return false; }
}
export function patchLocalReportMetadata(persisted: Record<string, ReportMetadata>, session: Record<string, ReportMetadata>, id: string, patch: Partial<Pick<ReportMetadata, 'favorite' | 'pinned' | 'tags'>>) {
  const merged = { ...persisted };
  for (const [taskId, value] of Object.entries(session)) merged[taskId] = mergeReportMetadata(persisted[taskId], value)!;
  const previous = merged[id] || emptyReportMetadata();
  const next = normalizeReportMetadata({ ...previous, ...patch, revision: previous.revision + 1 });
  if (!next) throw new Error('整理信息无效，请检查标签数量和长度。');
  return { ...merged, [id]: next };
}
export function parseReportTags(value: string) {
  const tags = [...new Set(value.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))];
  return { tags, error: tags.length > 8 ? '最多添加 8 个标签。' : tags.some(tag => [...tag].length > 20) ? '每个标签最多 20 个字，请精简后保存。' : '' };
}
export interface ReportFilters { query?: string; status?: TaskStatus | 'all' | 'active'; datasetId?: string; start?: string; end?: string; tag?: string; favoriteOnly?: boolean }
export function reportDateInfo(task: Task) {
  if (task.status === 'completed' && task.report && Number.isFinite(Date.parse(task.report.generatedAt))) return { value: task.report.generatedAt, label: '生成' };
  return { value: Number.isFinite(Date.parse(task.createdAt)) ? task.createdAt : '', label: '创建' };
}
export function filterReports(tasks: Task[], filters: ReportFilters, metadata: Record<string, ReportMetadata>) {
  const query = filters.query?.trim().toLocaleLowerCase() || '';
  return tasks.filter(task => {
    const meta = metadata[task.id] || task.metadata || emptyReportMetadata();
    const timestamp = Date.parse(reportDateInfo(task).value); const date = Number.isFinite(timestamp) ? new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10) : '';
    if (filters.status && filters.status !== 'all' && (filters.status === 'active' ? !['running', 'awaiting_approval'].includes(task.status) : task.status !== filters.status)) return false;
    if (filters.datasetId && task.datasetId !== filters.datasetId) return false;
    if (filters.start && (!date || date < filters.start) || filters.end && (!date || date > filters.end)) return false;
    if (filters.tag && !meta.tags.includes(filters.tag) || filters.favoriteOnly && !meta.favorite) return false;
    return !query || `${task.title} ${task.datasetName} ${meta.tags.join(' ')}`.toLocaleLowerCase().includes(query);
  }).sort((a, b) => Number((metadata[b.id] || b.metadata)?.pinned || false) - Number((metadata[a.id] || a.metadata)?.pinned || false) || (Date.parse(reportDateInfo(b).value) || 0) - (Date.parse(reportDateInfo(a).value) || 0) || a.id.localeCompare(b.id));
}
export function compareReports(left: Task, right: Task) {
  const a = left.report, b = right.report; const reasons: string[] = [];
  const confirmedPeriod = (value: string | undefined) => {
    const match = /^(\d{4}-\d{2}-\d{2}) 至 (\d{4}-\d{2}-\d{2})$/.exec(value || '');
    return Boolean(match && match[1] <= match[2] && [match[1], match[2]].every(day => Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day));
  };
  if (left.status !== 'completed' || right.status !== 'completed' || !a || !b) reasons.push('仅可对比已完成且已同步的报告。');
  if (!left.datasetId || left.datasetId !== right.datasetId) reasons.push('数据源不同。');
  if (!confirmedPeriod(a?.period) || !confirmedPeriod(b?.period) || a?.period !== b?.period) reasons.push('分析期间不同或无法确认。');
  if (!a?.currency || !b?.currency || a.currency !== b.currency) reasons.push('币种不同或无法确认。');
  if (!a?.methodology?.length || !b?.methodology?.length || [...a.methodology, ...b.methodology].some(note => !note.trim()) || JSON.stringify(a.methodology) !== JSON.stringify(b.methodology)) reasons.push('统计方法不同或缺少明确说明。');
  const definition = (task: Task) => task.report?.metrics.map(metric => [metric.id, metric.unit, metric.note]).sort(([x], [y]) => x.localeCompare(y));
  if (!a?.metrics?.length || !b?.metrics?.length || [...a.metrics, ...b.metrics].some(metric => !metric.id.trim() || !metric.unit.trim() || !metric.note.trim()) || JSON.stringify(definition(left)) !== JSON.stringify(definition(right))) reasons.push('指标集合、单位或统计口径不同。');
  const ids = [...new Set([...(a?.metrics || []).map(metric => metric.id), ...(b?.metrics || []).map(metric => metric.id)])];
  const rows = ids.map(id => {
    const metricA = a?.metrics.find(metric => metric.id === id), metricB = b?.metrics.find(metric => metric.id === id);
    const valueA = metricA?.value ?? null, valueB = metricB?.value ?? null;
    return { id, label: metricA?.label || metricB?.label || id, unit: metricA?.unit || metricB?.unit || '', leftUnit: metricA?.unit || '', rightUnit: metricB?.unit || '', left: valueA, right: valueB,
      difference: !reasons.length && typeof valueA === 'number' && typeof valueB === 'number' && Number.isFinite(valueA) && Number.isFinite(valueB) ? Math.round((valueB - valueA + Number.EPSILON) * 100) / 100 : null,
      differenceUnit: (metricA?.unit || metricB?.unit) === '%' ? '个百分点' : metricA?.unit || metricB?.unit || '',
    };
  });
  return { comparable: !reasons.length, reasons, rows };
}
export function continuationDraft(task: Task) {
  const marker = '\n业务背景：'; const position = task.goal.indexOf(marker);
  return { goal: position < 0 ? task.goal : task.goal.slice(0, position), context: position < 0 ? '' : task.goal.slice(position + marker.length), sourceTaskId: task.id, sourceTitle: task.title, inheritedMessages: task.messages.filter(message => message.role === 'user').map(message => message.content) };
}
