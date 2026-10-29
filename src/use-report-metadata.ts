import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth-context';
import { emptyReportMetadata, metadataStorageKey, mergeReportMetadata, normalizeReportMetadata, patchLocalReportMetadata, readLocalMetadata, saveLocalMetadata } from './report-assets';
import type { ReportMetadata, Task } from './types';
type MetadataPatch = Partial<Pick<ReportMetadata, 'favorite' | 'pinned' | 'tags'>>;
export function useReportMetadata(onUpdate: (task: Task) => void, notify: (message: string, error?: boolean) => void) {
  const { runtime, user } = useAuth(); const supported = runtime.capabilities?.reportMetadata === true;
  const key = metadataStorageKey(runtime.mode, user?.id, window.location.origin);
  const [local, setLocal] = useState<Record<string, ReportMetadata>>(() => { try { return readLocalMetadata(localStorage, key); } catch { return {}; } });
  const [blockedStorage, setBlockedStorage] = useState(false); const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const currentLocal = useRef(local); currentLocal.current = local; const pending = useRef(new Set<string>()); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (supported) return;
    function changed(event: StorageEvent) {
      if (event.key !== null && event.key !== key) return;
      if (event.key === null || event.newValue === null) { currentLocal.current = {}; setLocal({}); return; }
      try {
        const incoming = readLocalMetadata(localStorage, key); const next = { ...incoming };
        for (const [id, value] of Object.entries(currentLocal.current)) next[id] = mergeReportMetadata(incoming[id], value)!;
        currentLocal.current = next; setLocal(next);
      } catch { /* 存储读取被禁止时保留当前会话中的整理结果。 */ }
    }
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, [key, supported]);
  const get = (task: Task) => supported ? normalizeReportMetadata(task.metadata) || emptyReportMetadata() : local[task.id] || emptyReportMetadata();
  async function save(task: Task, patch: MetadataPatch) {
    if (pending.current.has(task.id)) throw new Error('正在保存这份报告，请稍候。');
    pending.current.add(task.id); setBusyIds(new Set(pending.current));
    try {
      if (supported) {
        const result = await api.reportMetadata(task.id, patch); if (alive.current) onUpdate(result.task);
      } else {
        function persist() {
          let storage: Storage | undefined; let readable = false; let persisted: Record<string, ReportMetadata> = {};
          try { storage = localStorage; const raw = storage.getItem(key); persisted = readLocalMetadata({ getItem: () => raw }, key); readable = true; } catch { /* 不覆盖无法读取的持久信息。 */ }
          const next = patchLocalReportMetadata(persisted, currentLocal.current, task.id, patch); currentLocal.current = next;
          if (alive.current) setLocal(next);
          return Boolean(readable && storage && saveLocalMetadata(storage, key, next));
        }
        const saved = navigator.locks ? await navigator.locks.request(key, persist) : persist();
        if (!saved && alive.current) { setBlockedStorage(true); notify('浏览器未允许保存，整理结果仅保留本次会话。'); }
        else if (alive.current) setBlockedStorage(false);
      }
    } finally { pending.current.delete(task.id); if (alive.current) setBusyIds(new Set(pending.current)); }
  }
  return { get, save, busyIds, label: supported ? runtime.mode === 'cloud' ? '整理信息按当前账号保存在服务端' : '整理信息保存在本机分析服务' : blockedStorage ? '无法持久保存：整理结果仅保留本次会话' : '当前服务未支持同步，整理信息仅保存在此设备的当前账号' };
}
export type ReportMetadataController = ReturnType<typeof useReportMetadata>;
