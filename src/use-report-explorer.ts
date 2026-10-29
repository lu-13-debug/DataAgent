import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth-context';
import { frozenCutoff, normalizeExploreInput, rangeFromBrush, reportDates, sameExploreInput, scopeInput, validateExploreInput } from './report-explorer';
import type { ExploreInput, Exploration, Task } from './types';

export function useReportExplorer(task: Task | undefined, supported: boolean) {
  const { runtime, user } = useAuth();
  const report = task?.status === 'completed' ? task.report : undefined;
  const enabled = supported === true && !!report;
  const boundary = JSON.stringify([window.location.origin, runtime.mode, user?.id || '', task?.id || '', report?.generatedAt || '', enabled]);
  const dates = reportDates(report);
  const originalRange = { start: dates[0] || '', end: dates.at(-1) || '' };
  const base: ExploreInput = { ...originalRange, channels: [], comparePrevious: false };
  const cutoff = frozenCutoff(report?.generatedAt || '');
  const [draftState, setDraftState] = useState({ boundary, value: base });
  const [resultState, setResultState] = useState<{ boundary: string; value: Exploration }>();
  const [requestState, setRequestState] = useState({ boundary, loading: false, error: '' });
  const latestBoundary = useRef(boundary); latestBoundary.current = boundary;
  const draftRef = useRef(draftState); draftRef.current = draftState.boundary === boundary ? draftState : { boundary, value: base };
  const sequence = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function cancel() {
    sequence.current++;
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined; controller.current?.abort(); controller.current = undefined;
  }
  useEffect(() => {
    setDraftState({ boundary, value: base }); setResultState(undefined);
    setRequestState({ boundary, loading: false, error: '' });
    return cancel;
    // A report poll with the same frozen statistical moment must retain the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundary]);

  function setDraft(input: ExploreInput) {
    if (!enabled || latestBoundary.current !== boundary) return;
    cancel(); const next = { boundary, value: normalizeExploreInput(input) };
    draftRef.current = next; setDraftState(next); setRequestState({ boundary, loading: false, error: '' });
  }
  async function perform(input: ExploreInput) {
    cancel();
    if (!enabled || !task || latestBoundary.current !== boundary) return;
    const value = normalizeExploreInput(input), error = validateExploreInput(value, cutoff);
    if (error) { setRequestState({ boundary, loading: false, error }); return; }
    const current = sequence.current, abort = new AbortController(); controller.current = abort;
    setRequestState({ boundary, loading: true, error: '' });
    const currentRequest = () => current === sequence.current && latestBoundary.current === boundary && !abort.signal.aborted;
    try {
      const result = await api.explore(task.id, value, abort.signal);
      if (currentRequest()) setResultState({ boundary, value: result });
    } catch (cause) {
      const message = cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' ? cause.message : '精确探索失败，请稍后重试。';
      if (currentRequest()) setRequestState({ boundary, loading: false, error: message });
    } finally {
      if (currentRequest()) { controller.current = undefined; setRequestState(state => ({ ...state, loading: false })); }
    }
  }
  function apply() { return perform(draftRef.current.value); }
  function clear() {
    cancel(); const next = { boundary, value: base }; draftRef.current = next;
    setDraftState(next); setResultState(undefined); setRequestState({ boundary, loading: false, error: '' });
  }
  function setRangeFromBrush(startIndex: number, endIndex: number) {
    if (!enabled) return;
    const range = rangeFromBrush(dates, startIndex, endIndex); if (!range) return;
    const next = { ...draftRef.current.value, ...range }; setDraft(next);
    timer.current = setTimeout(() => { timer.current = undefined; void perform(next); }, 350);
  }
  const result = enabled && resultState?.boundary === boundary ? resultState.value : undefined;
  const draft = draftState.boundary === boundary ? draftState.value : base;
  const applied = result ? scopeInput(result.scope, result.comparison.requested) : base;
  return {
    enabled, displayReport: result?.report || report, result, draft, appliedScope: result?.scope,
    loading: requestState.boundary === boundary && requestState.loading,
    error: requestState.boundary === boundary ? requestState.error : '',
    dirty: enabled && !sameExploreInput(draft, applied), dates, originalRange, cutoff,
    setDraft, apply, clear, setRangeFromBrush,
  };
}
export type ReportExplorerState = ReturnType<typeof useReportExplorer>;
