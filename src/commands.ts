export interface Command { id: string; title: string; group: string; hint?: string; keywords?: string; run: () => void }
type Searchable = Pick<Command, 'id' | 'title' | 'group' | 'keywords'>;
export function selectedCommandIndex(items: Pick<Command, 'id'>[], selectedId: string | null) {
  if (!items.length) return -1;
  const index = items.findIndex(item => item.id === selectedId); return index < 0 ? 0 : index;
}
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
function matchScore(text: string, term: string) {
  if (text.startsWith(term)) return 100;
  if (text.includes(term)) return 60;
  let position = 0; let gaps = 0;
  for (const character of term) {
    const found = text.indexOf(character, position); if (found < 0) return -1;
    gaps += found - position; position = found + character.length;
  }
  return 30 - Math.min(20, gaps);
}
export function searchCommands<T extends Searchable>(items: T[], query: string, recent: string[]): T[] {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  return items.map((item, index) => {
    const text = normalized(`${item.title} ${item.keywords || ''} ${item.group}`);
    const scores = terms.map(term => matchScore(text, term));
    const recentIndex = recent.indexOf(item.id);
    return { item, index, score: scores.some(score => score < 0) ? -1 : scores.reduce((a, b) => a + b, 0), recentIndex: recentIndex < 0 ? Infinity : recentIndex };
  }).filter(item => item.score >= 0).sort((a, b) => b.score - a.score || a.recentIndex - b.recentIndex || a.index - b.index).slice(0, 40).map(item => item.item);
}
export function commandStorageKey(runtime: string, userId: string | undefined, origin: string) {
  return `dataagent:commands:v1:${runtime}:${encodeURIComponent(origin)}:${runtime === 'cloud' ? encodeURIComponent(userId || 'anonymous') : 'local'}`;
}
export function readRecentCommands(storage: Pick<Storage, 'getItem'>, key: string): string[] {
  try {
    const value = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))].slice(0, 12) : [];
  } catch { return []; }
}
export function rememberCommand(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, id: string) {
  if (!id || id.length > 200) return;
  try { storage.setItem(key, JSON.stringify([id, ...readRecentCommands(storage, key).filter(item => item !== id)].slice(0, 12))); } catch { /* 存储不可用时仍可执行命令。 */ }
}
interface ShortcutEvent { key: string; keyCode?: number; repeat?: boolean; isComposing?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; target?: { tagName?: string; isContentEditable?: boolean } | null }
export function shortcutAction(event: ShortcutEvent, dialogOpen: boolean, paletteOpen = false): 'commands' | 'new' | 'shortcuts' | 'appearance' | null {
  if (event.isComposing || event.keyCode === 229 || event.repeat) return null;
  if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) return !dialogOpen || paletteOpen ? 'commands' : null;
  if (event.key.toLowerCase() === 'd' && (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey) return dialogOpen ? null : 'appearance';
  if (dialogOpen || event.metaKey || event.ctrlKey || event.altKey || event.target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName || '')) return null;
  return event.key.toLowerCase() === 'n' ? 'new' : event.key === '?' ? 'shortcuts' : null;
}
