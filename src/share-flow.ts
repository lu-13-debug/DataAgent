export const validShareToken = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);
export interface ShareReaderState<T> { token: string; visitorToken: string; report: T | null; status: 'loading' | 'ready' | 'unavailable' }
export function createShareReader<T>(options: { makeVisitor: () => string; read: (token: string) => Promise<T>; visit: (token: string, visitor: string) => unknown; publish: (state: ShareReaderState<T>) => void }) {
  let current: string | undefined; let generation = 0;
  return {
    open(token: string) {
      if (token === current) return;
      current = token; const revision = ++generation;
      let visitorToken = '';
      try { if (validShareToken(token)) visitorToken = options.makeVisitor(); } catch { /* no secure random source */ }
      if (!validShareToken(token) || !validShareToken(visitorToken)) { options.publish({token, visitorToken: '', report: null, status: 'unavailable'}); return; }
      options.publish({token, visitorToken, report: null, status: 'loading'});
      void options.read(token).then(report => {
        if (revision !== generation) return;
        options.publish({token, visitorToken, report, status: 'ready'});
        try { void Promise.resolve(options.visit(token, visitorToken)).catch(() => {}); } catch { /* visit is optional */ }
      }).catch(() => { if (revision === generation) options.publish({token, visitorToken, report: null, status: 'unavailable'}); });
    },
    dispose() { generation++; current = undefined; }
  };
}
export async function createManagedShare<T>(create: () => Promise<T>, refresh: () => Promise<void>, onCreated?: (value:T) => void): Promise<{kind:'created'; value:T; refreshFailed:boolean; refreshError?:unknown} | {kind:'unknown'; error:unknown}> {
  let value: T;
  try { value = await create(); } catch (error) { await refresh().catch(() => {}); return {kind:'unknown', error}; }
  onCreated?.(value);
  try { await refresh(); return {kind:'created', value, refreshFailed:false}; } catch (refreshError) { return {kind:'created', value, refreshFailed:true, refreshError}; }
}
export async function revokeManagedShare(remove: () => Promise<unknown>, apply: () => void, refresh: () => Promise<void>): Promise<{kind:'failed'; error:unknown} | {kind:'revoked' | 'revoked-refresh-failed'; error?:unknown}> {
  try { await remove(); } catch (error) { return {kind:'failed', error}; }
  apply();
  try { await refresh(); return {kind:'revoked'}; } catch (error) { return {kind:'revoked-refresh-failed', error}; }
}

export function createShareListController<T>(load: () => Promise<T>, publish: (value:T) => void) {
  let revision = 0; let active = true;
  return {
    async refresh() { const current = ++revision; const value = await load(); if (active && current === revision) publish(value); },
    invalidate() { revision++; },
    dispose() { active = false; revision++; },
    isActive() { return active; }
  };
}
