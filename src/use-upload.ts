import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { DataIssue, Dataset } from './types';

export function useUpload(onSuccess: (dataset: Dataset) => void) {
  const controller = useRef<AbortController | null>(null); const mounted = useRef(true); const callback = useRef(onSuccess); callback.current = onSuccess;
  const [state, setState] = useState<{ status: 'idle' | 'transferring' | 'processing' | 'failed' | 'cancelled' | 'success'; progress: number | null; error: string; issues: DataIssue[] }>({ status: 'idle', progress: null, error: '', issues: [] });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  async function start(files: File[]) {
    if (controller.current || !files.length) return;
    const current = new AbortController(); controller.current = current;
    setState({ status: 'transferring', progress: 0, error: '', issues: [] });
    try {
      const { dataset } = await api.upload(files, { signal: current.signal, onProgress: progress => { if (mounted.current && !current.signal.aborted) setState(previous => ({ ...previous, progress, status: progress === 100 ? 'processing' : 'transferring' })); } });
      if (mounted.current && !current.signal.aborted) { setState({ status: 'success', progress: 100, error: '', issues: [] }); callback.current(dataset); }
    } catch (error) {
      if (mounted.current) setState({ status: (error as Error).name === 'AbortError' ? 'cancelled' : 'failed', progress: null, error: (error as Error).name === 'AbortError' ? '' : (error as Error).message, issues: (error as { issues?: DataIssue[] }).issues || [] });
    } finally { if (controller.current === current) controller.current = null; }
  }
  return { ...state, busy: state.status === 'transferring' || state.status === 'processing', start, cancel: () => controller.current?.abort() };
}
