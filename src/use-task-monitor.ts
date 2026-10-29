import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { showDesktopWindow } from './desktop-tray';
import { connectionExpired, createTerminalTracker, isTerminal } from './task-monitor';
import type { Bootstrap, Runtime, Task, TaskSnapshot, TaskSummary } from './types';

interface Options {
  data: Bootstrap | null; activeId: string | null; runtime: Runtime;
  onSnapshot: (snapshot: TaskSnapshot) => void; onDetails: (task: Task) => void; onBootstrap: (data: Bootstrap) => void;
  onTerminal: (task: TaskSummary) => void; onFocusTask: (id: string) => void;
}
export function useTaskMonitor(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => 'Notification' in window ? Notification.permission : 'unsupported');
  const refreshRef = useRef<() => void>(() => {});
  const ready = Boolean(options.data);
  useEffect(() => {
    if (!ready) return;
    let alive = true; let source: EventSource | null = null; let sourceOpen = false; let lastContact = Date.now(); let lastEventContact = Date.now(); let lastPoll = 0; let summaryBusy = false; let detailBusy = false; let calibrationBusy = false; let calibrationFailures = 0; let legacyIndex = 0; let calibrationTimer: ReturnType<typeof setTimeout> | undefined;
    const controllers = new Set<AbortController>(); const notices = new Set<Notification>(); const baseTitle = document.title;
    const tracker = createTerminalTracker(latest.current.data!.tasks); const calibrated = new Set(latest.current.data!.tasks.filter(task => isTerminal(task.status)).map(task => task.id)); const pendingCalibration = new Set<string>();
    const needsDetails = new Set<string>(); const capabilities = latest.current.runtime.capabilities;
    const backgroundMonitor = () => !document.hidden || Boolean(window.dataagentDesktop);
    const contact = () => { lastContact = Date.now(); if (alive) setConnection('connected'); };
    function requestSignal() {
      const controller = new AbortController(); controllers.add(controller);
      return { controller, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]), finish: () => controllers.delete(controller) };
    }
    function terminal(task: TaskSummary) {
      if (!['completed', 'failed'].includes(task.status)) return;
      latest.current.onTerminal(task);
      const title = task.status === 'completed' ? '分析已完成' : '分析未完成';
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const notice = new Notification(title, { body: task.title, tag: `dataagent-task-${task.id}` }); notices.add(notice);
          notice.onclick = () => { if (alive) { window.focus(); showDesktopWindow(window.dataagentDesktop); latest.current.onFocusTask(task.id); } notice.close(); notices.delete(notice); };
          notice.onclose = () => notices.delete(notice);
        } catch { document.title = `${title} · ${task.title} — DataAgent`; }
      } else document.title = `${title} · ${task.title} — DataAgent`;
    }
    async function calibrate() {
      if (!alive || !backgroundMonitor() || calibrationBusy || !pendingCalibration.size) return;
      calibrationBusy = true; const ids = [...pendingCalibration]; const request = requestSignal();
      try {
        const data = await api.bootstrap(request.signal); if (!alive) return;
        latest.current.onBootstrap(data); contact(); calibrationFailures = 0;
        for (const id of ids) { calibrated.add(id); pendingCalibration.delete(id); }
      } catch { calibrationFailures++; if (alive && !document.hidden && connectionExpired(lastContact, Date.now(), false)) setConnection('reconnecting'); }
      finally {
        calibrationBusy = false; request.finish();
        if (alive && pendingCalibration.size && backgroundMonitor()) {
          const delay = calibrationFailures ? Math.min(15000, 1000 * 2 ** Math.min(4, calibrationFailures - 1)) : 250;
          calibrationTimer = setTimeout(() => { calibrationTimer = undefined; if (backgroundMonitor()) void calibrate(); }, delay);
        }
      }
    }
    function snapshot(value: TaskSnapshot) {
      if (!alive || !Array.isArray(value?.summaries) || !value.wallet) return;
      contact();
      const current = latest.current.data;
      for (const task of value.summaries) {
        if (isTerminal(task.status) && !calibrated.has(task.id)) pendingCalibration.add(task.id);
        const full = current?.tasks.find(item => item.id === task.id);
        if (!full || full.updatedAt !== task.updatedAt || full.status !== task.status || full.progress !== task.progress || !full.steps.some(step => Boolean(step.description))) needsDetails.add(task.id);
      }
      latest.current.onSnapshot(value);
      tracker.observe(value.summaries).forEach(terminal);
      if (backgroundMonitor() && pendingCalibration.size && !calibrationTimer && !calibrationBusy) calibrationTimer = setTimeout(() => { calibrationTimer = undefined; void calibrate(); }, 150);
    }
    async function summaries() {
      if (!alive || !backgroundMonitor() || summaryBusy) return;
      summaryBusy = true; lastPoll = Date.now(); const request = requestSignal();
      try { if (capabilities?.taskSummaries) { const result = await api.taskSummaries(request.signal); if (alive) snapshot(result); } else { await api.health(request.signal); if (alive) contact(); } }
      catch { if (alive && !document.hidden && connectionExpired(lastContact, Date.now(), false)) setConnection('reconnecting'); }
      finally { summaryBusy = false; request.finish(); }
    }
    async function details() {
      if (!alive || !backgroundMonitor() || detailBusy) return;
      const current = latest.current; const pending = current.data?.tasks.filter(item => !isTerminal(item.status)) || [];
      const task = !capabilities?.taskEvents && pending.length ? pending[legacyIndex++ % pending.length] : current.data?.tasks.find(item => item.id === current.activeId);
      if (!task || (capabilities?.taskEvents && sourceOpen && !needsDetails.has(task.id)) || (isTerminal(task.status) && task.report && !needsDetails.has(task.id))) return;
      detailBusy = true; const request = requestSignal();
      try {
        const result = await api.task(task.id, request.signal); if (!alive) return;
        needsDetails.delete(task.id); latest.current.onDetails(result.task); contact();
        if (!capabilities?.taskSummaries) snapshot({ summaries: [{ ...result.task, steps: result.task.steps }], wallet: result.wallet, walletVersion: result.walletVersion });
      } catch { if (alive && !document.hidden && connectionExpired(lastContact, Date.now(), false)) setConnection('reconnecting'); }
      finally { detailBusy = false; request.finish(); }
    }
    function openEvents() {
      if (!capabilities?.taskEvents || !('EventSource' in window)) return;
      source?.close(); sourceOpen = false; lastEventContact = Date.now();
      source = new EventSource('/api/tasks/events', { withCredentials: true });
      source.onopen = () => { sourceOpen = true; lastEventContact = Date.now(); contact(); };
      source.addEventListener('heartbeat', () => { sourceOpen = true; lastEventContact = Date.now(); contact(); });
      source.addEventListener('snapshot', event => {
        const text = (event as MessageEvent<string>).data;
        try { if (text.length <= 256 * 1024) { lastEventContact = Date.now(); snapshot(JSON.parse(text)); } } catch { /* 格式异常不覆盖已知任务状态。 */ }
      });
      source.onerror = () => { sourceOpen = false; if (alive && !document.hidden && connectionExpired(lastContact, Date.now(), false)) setConnection('reconnecting'); };
    }
    function tick() {
      if (!alive) return;
      if (source && Date.now() - lastEventContact > 8000) openEvents();
      if (!backgroundMonitor()) return;
      if (connectionExpired(lastContact, Date.now(), false)) setConnection('reconnecting');
      if ((!sourceOpen || !capabilities?.taskEvents) && Date.now() - lastPoll >= 3000) void summaries();
      void details();
    }
    function visibility() {
      if (document.hidden) { for (const controller of controllers) controller.abort(); }
      else { document.title = baseTitle; if (connectionExpired(lastContact, Date.now(), false)) setConnection('reconnecting'); needsDetails.add(latest.current.activeId || ''); void summaries(); void details(); if (pendingCalibration.size) void calibrate(); }
    }
    const offline = () => { if (alive) setConnection('reconnecting'); };
    const online = () => { if (!alive) return; openEvents(); if (!document.hidden) { void summaries(); void details(); } };
    const focus = () => { if (alive) document.title = baseTitle; };
    refreshRef.current = () => { needsDetails.add(latest.current.activeId || ''); void summaries(); void details(); };
    openEvents(); if (!capabilities?.taskEvents) void summaries(); void details();
    const timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('offline', offline); window.addEventListener('online', online); window.addEventListener('focus', focus);
    return () => {
      alive = false; source?.close(); clearInterval(timer); clearTimeout(calibrationTimer); for (const controller of controllers) controller.abort(); for (const notice of notices) notice.close(); document.title = baseTitle;
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('offline', offline); window.removeEventListener('online', online); window.removeEventListener('focus', focus); refreshRef.current = () => {};
    };
  }, [ready, options.runtime]);
  const enableNotifications = useCallback(async () => {
    if (!('Notification' in window)) { setPermission('unsupported'); return; }
    try { setPermission(await Notification.requestPermission()); } catch { setPermission('denied'); }
  }, []);
  return { connection, permission, enableNotifications, refresh: useCallback(() => refreshRef.current(), []) };
}
