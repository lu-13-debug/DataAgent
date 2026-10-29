import type { ExploreInput, ExploreMetricComparison, Exploration, ExploreScope, Report } from './types';

const DAY = 86400000;
export function isCalendarDate(value: string) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function frozenCutoff(generatedAt: string) {
  const time = Date.parse(generatedAt);
  return Number.isFinite(time) ? new Date(time + 8 * 3600000 - DAY).toISOString().slice(0, 10) : '';
}
export function reportDates(report?: Pick<Report, 'daily'>) {
  return [...new Set((report?.daily || []).map(day => day.date).filter(isCalendarDate))].sort();
}
export function rangeFromBrush(dates: string[], startIndex: number, endIndex: number) {
  if (!dates.length || !Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return;
  const clamp = (index: number) => Math.max(0, Math.min(dates.length - 1, Math.round(index)));
  const a = clamp(startIndex), b = clamp(endIndex);
  return { start: dates[Math.min(a, b)], end: dates[Math.max(a, b)] };
}
export function brushIndices(dates: string[], range: Pick<ExploreInput, 'start' | 'end'>) {
  if (!dates.length) return { startIndex: 0, endIndex: 0 };
  let startIndex = dates.findIndex(date => date >= range.start);
  if (startIndex < 0) startIndex = dates.length - 1;
  let endIndex = dates.length - 1;
  while (endIndex > 0 && dates[endIndex] > range.end) endIndex--;
  return { startIndex: Math.min(startIndex, endIndex), endIndex: Math.max(startIndex, endIndex) };
}
export function validateExploreInput(input: ExploreInput, cutoff: string) {
  if (!isCalendarDate(input.start) || !isCalendarDate(input.end)) return '请输入有效的开始和结束日期。';
  if (input.start > input.end) return '开始日期不能晚于结束日期。';
  if ((Date.parse(input.end) - Date.parse(input.start)) / DAY + 1 > 3660) return '单次最多探索 3660 个自然日，请缩小范围。';
  if (!cutoff || input.end > cutoff) return `仅可探索原报告生成时已结束的完整自然日${cutoff ? `（截至 ${cutoff}）` : ''}。`;
  if ((input.channels || []).length > 50) return '最多同时选择 50 个渠道。';
  return '';
}
export function normalizeExploreInput(input: ExploreInput): ExploreInput {
  return { start: input.start, end: input.end, channels: [...new Set((input.channels || []).map(name => name.trim()).filter(Boolean))].sort(), comparePrevious: input.comparePrevious === true };
}
export function sameExploreInput(a: ExploreInput, b: ExploreInput) {
  return JSON.stringify(normalizeExploreInput(a)) === JSON.stringify(normalizeExploreInput(b));
}
export function scopeInput(scope: ExploreScope, comparePrevious = false): ExploreInput {
  return { start: scope.start, end: scope.end, channels: scope.channels, comparePrevious };
}
export function scopeLabel(scope?: Pick<ExploreScope, 'start' | 'end' | 'channels'>, fallback = '原始报告完整范围') {
  return scope ? `${scope.start} 至 ${scope.end} · ${scope.channels.length ? `渠道：${scope.channels.join('、')}` : '全部渠道'}` : fallback;
}
export function metricComparison(result: Exploration | undefined, id: string): ExploreMetricComparison | undefined {
  const metric = result?.comparison.requested ? result.comparison.metrics.find(item => item.id === id) : undefined;
  if (!metric) return;
  const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  if (!metric.comparable || !numeric(metric.current) || !numeric(metric.previous) || metric.previous === 0 || !numeric(metric.absoluteChange) || !numeric(metric.percentChange)) {
    return { ...metric, comparable: false, absoluteChange: null, percentChange: null, reason: metric.reason || '当前期或上期无可用指标、有效分母或完整覆盖。' };
  }
  return metric;
}

export type AnnotationType = 'version' | 'campaign' | 'event';
export interface ReportAnnotation { id: string; date: string; type: AnnotationType; text: string }
export const annotationTypeLabels: Record<AnnotationType, string> = { version: '版本发布', campaign: '运营活动', event: '背景记录' };
export function annotationStorageKey(runtime: string, userId: string | undefined, origin: string, taskId: string) {
  return `dataagent:report-annotations:v1:${[origin, runtime, userId || (runtime === 'cloud' ? 'anonymous' : 'local'), taskId].map(encodeURIComponent).join(':')}`;
}
function cleanAnnotations(value: unknown): ReportAnnotation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 100).flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[\w-]{1,100}$/.test(item.id) || seen.has(item.id) || typeof item.date !== 'string' || !isCalendarDate(item.date) || !Object.hasOwn(annotationTypeLabels, item.type) || typeof item.text !== 'string' || !item.text.trim() || [...item.text.trim()].length > 300) return [];
    seen.add(item.id); return [{ id: item.id, date: item.date, type: item.type as AnnotationType, text: item.text.trim() }];
  });
}
export interface AnnotationState { list: ReportAnnotation[]; blocked: boolean }
interface CachedAnnotationState extends AnnotationState { storageVersion?: string; pending: boolean }
type AnnotationReader = Pick<Storage, 'getItem'> | undefined;
type AnnotationWriter = (Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'getItem'>>) | undefined;
// Module memory belongs to this window only. It survives component unmounts,
// contains no credentials/raw records and evicts the least recently used scope.
const annotationSession = new Map<string, CachedAnnotationState>();
function annotationStorageVersion(raw: string | null) {
  if (raw === null) return 'missing';
  let a = 2166136261, b = 5381;
  for (let index = 0; index < raw.length; index++) { const code = raw.charCodeAt(index); a = Math.imul(a ^ code, 16777619); b = Math.imul(b, 33) ^ code; }
  return `${raw.length}:${a >>> 0}:${b >>> 0}`;
}
function rememberAnnotations(key: string, state: CachedAnnotationState): AnnotationState {
  annotationSession.delete(key); annotationSession.set(key, state);
  while (annotationSession.size > 50) annotationSession.delete(annotationSession.keys().next().value!);
  return { list: cleanAnnotations(state.list), blocked: state.blocked };
}
export function readAnnotationState(storage: AnnotationReader, key: string, storageChanged = false): AnnotationState {
  const cached = annotationSession.get(key);
  let raw: string | null;
  try {
    if (!storage) throw new Error('Storage unavailable');
    raw = storage.getItem(key);
  } catch {
    return rememberAnnotations(key, { list: cached?.list || [], blocked: true, pending: cached?.pending || false, storageVersion: cached?.storageVersion });
  }
  // A failed write can leave readable storage unchanged (for example quota).
  // Preserve those unsaved session edits until storage actually changes. A
  // storage delete/clear event is authoritative even when the old value is null.
  const version = raw === null || raw.length <= 200000 ? annotationStorageVersion(raw) : undefined;
  if (!storageChanged && cached?.pending && cached.storageVersion !== undefined && cached.storageVersion === version) return rememberAnnotations(key, cached);
  try {
    if (raw && raw.length > 200000) throw new Error('Stored annotations too large');
    const parsed: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) throw new Error('Invalid stored annotations');
    return rememberAnnotations(key, { list: cleanAnnotations(parsed), blocked: false, pending: false, storageVersion: version });
  } catch {
    // Corrupt/oversized storage is not evidence of old annotations. Do not
    // resurrect memory over a successful read of damaged or deleted data.
    return rememberAnnotations(key, { list: [], blocked: true, pending: false });
  }
}
export function readAnnotations(storage: AnnotationReader, key: string) {
  return readAnnotationState(storage, key).list;
}
export function saveAnnotations(storage: AnnotationWriter, key: string, entries: ReportAnnotation[]) {
  const list = cleanAnnotations(entries), cached = annotationSession.get(key);
  let storageVersion = cached?.storageVersion;
  if (storageVersion === undefined) {
    try { const value = storage?.getItem?.(key); if (value === null || typeof value === 'string' && value.length <= 200000) storageVersion = annotationStorageVersion(value); } catch { /* Access may be prohibited. */ }
  }
  rememberAnnotations(key, { list, blocked: true, pending: true, storageVersion });
  try {
    if (!storage) throw new Error('Storage unavailable');
    const serialized = JSON.stringify(list); storage.setItem(key, serialized);
    rememberAnnotations(key, { list, blocked: false, pending: false, storageVersion: annotationStorageVersion(serialized) }); return true;
  } catch { return false; }
}

export type TrendRow = Report['daily'][number] & { previousDate?: string; previousDau: number | null; previousNewUsers: number | null; previousRevenue: number | null; previousPayers: number | null };
export function trendRows(report: Pick<Report, 'daily'>, previous?: Pick<Report, 'daily'>): TrendRow[] {
  return report.daily.map((day, index) => ({ ...day, previousDate: previous?.daily[index]?.date, previousDau: previous?.daily[index]?.dau ?? null, previousNewUsers: previous?.daily[index]?.newUsers ?? null, previousRevenue: previous?.daily[index]?.revenue ?? null, previousPayers: previous?.daily[index]?.payers ?? null }));
}
export interface PlotBox { left: number; top: number; width: number; height: number; max: number }
export function trendScrollLeft(viewportWidth: number, svgWidth: number, index: number, length: number, currentScroll: number) {
  if (viewportWidth >= svgWidth || viewportWidth <= 0 || svgWidth <= 0 || length < 1) return 0;
  const x = (72 + (length > 1 ? Math.max(0, Math.min(length - 1, index)) * 852 / (length - 1) : 426)) * svgWidth / 960;
  if (x >= currentScroll + 32 && x <= currentScroll + viewportWidth - 32) return currentScroll;
  return Math.max(0, Math.min(svgWidth - viewportWidth, x - viewportWidth / 2));
}
export function linePaths(rows: TrendRow[], key: keyof TrendRow, box: PlotBox) {
  const paths: string[] = []; let path = '';
  rows.forEach((row, index) => {
    const value = row[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) { if (path) paths.push(path); path = ''; return; }
    const x = box.left + (rows.length > 1 ? index * box.width / (rows.length - 1) : box.width / 2);
    const y = box.top + box.height - Math.max(0, value) * box.height / (box.max || 1);
    path += `${path ? ' L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  });
  if (path) paths.push(path); return paths;
}
