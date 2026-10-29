export type ThemePreference = 'light' | 'dark' | 'system';
export type ViewDensity = 'concise' | 'standard';
export interface AppearancePreference { theme: ThemePreference; view: ViewDensity }
export interface Appearance extends AppearancePreference { resolvedTheme: 'light' | 'dark' }
type PartialAppearance = { theme?: unknown; view?: unknown };

export function appearanceKey(origin?: string, userId?: string) {
  return `dataagent:appearance:v1:${encodeURIComponent(origin || 'local')}:${userId ? encodeURIComponent(userId) : 'local'}`;
}
export function resolveAppearance(stored: PartialAppearance | null | undefined, systemPrefersDark: boolean): Appearance {
  const theme: ThemePreference = stored?.theme === undefined ? 'system' : stored.theme === 'light' || stored.theme === 'dark' || stored.theme === 'system' ? stored.theme : 'light';
  const view: ViewDensity = stored?.view === 'concise' ? 'concise' : 'standard';
  return { theme, resolvedTheme: theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme, view };
}
export function readAppearance(storage: Pick<Storage, 'getItem'>, origin?: string, userId?: string): AppearancePreference {
  let raw: string | null;
  try { raw = storage.getItem(appearanceKey(origin, userId)); } catch { return { theme: 'system', view: 'standard' }; }
  if (!raw) return { theme: 'system', view: 'standard' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { theme: 'light', view: 'standard' };
    const { theme, view } = resolveAppearance(parsed, false); return { theme, view };
  } catch { return { theme: 'light', view: 'standard' }; }
}
export function saveAppearance(storage: Pick<Storage, 'setItem'>, origin: string | undefined, userId: string | undefined, value: AppearancePreference) {
  try { const { theme, view } = resolveAppearance(value, false); storage.setItem(appearanceKey(origin, userId), JSON.stringify({ theme, view })); } catch { /* 存储不可用时保留本次会话设置。 */ }
}
export const railKey = (origin?: string, userId?: string) => `${appearanceKey(origin, userId)}:rail`;
export const resolveRail = (preference: boolean | null, view: ViewDensity) => preference === null ? view === 'concise' : preference;
export function readRail(storage: Pick<Storage,'getItem'>, origin?: string, userId?: string): boolean | null {
  try { const value = storage.getItem(railKey(origin, userId)); return value === 'collapsed' ? true : value === 'expanded' ? false : null; } catch { return null; }
}
export function saveRail(storage: Pick<Storage,'setItem'>, origin: string | undefined, userId: string | undefined, value: boolean) {
  try { storage.setItem(railKey(origin,userId), value ? 'collapsed' : 'expanded'); } catch { /* 存储不可用时保留当前会话。 */ }
}
