import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Clock3, Search } from 'lucide-react';
import { useAuth } from '../auth-context';
import { commandStorageKey, readRecentCommands, rememberCommand, searchCommands, selectedCommandIndex } from '../commands';
import type { Command } from '../commands';
import { Modal } from './ui';

export function CommandPalette({ commands, close }: { commands: Command[]; close: () => void }) {
  const { runtime, user } = useAuth();
  const key = commandStorageKey(runtime.mode, user?.id, window.location.origin);
  const [recent] = useState(() => { try { return readRecentCommands(localStorage, key); } catch { return []; } });
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null); const list = useRef<HTMLDivElement>(null); const id = useId();
  const results = searchCommands(commands, query, recent);
  const [selection, setSelection] = useState<string | null>(() => results[0]?.id || null);
  const active = selectedCommandIndex(results, selection); const resultIds = results.map(command => command.id).join('\n');
  useEffect(() => { const frame = requestAnimationFrame(() => input.current?.focus()); return () => cancelAnimationFrame(frame); }, []);
  useEffect(() => {
    const chosenId = results[active]?.id || null;
    if (selection !== chosenId) setSelection(chosenId);
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [active, query, resultIds, selection]);
  function execute(command: Command) {
    try { rememberCommand(localStorage, key, command.id); } catch { /* 本次命令不依赖浏览器存储。 */ }
    close(); command.run();
  }
  return <Modal title="查找并执行" subtitle="搜索页面、报告、数据源、Skill 或操作" close={close}>
    <div className="modal-body command-palette">
      <label className="command-search"><Search size={18} /><input ref={input} role="combobox" aria-label="搜索命令" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={results.length ? `${id}-option-${active}` : undefined} value={query} placeholder="例如：留存报告、模型设置、新建分析" onChange={event => { setQuery(event.target.value); setSelection(searchCommands(commands, event.target.value, recent)[0]?.id || null); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSelection(results.length ? results[(active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length].id : null); }
        if (event.key === 'Enter') { event.preventDefault(); if (results[active]) execute(results[active]); }
      }} /></label>
      <p className="command-results-label" role="status" aria-live="polite">{query ? `找到 ${results.length} 个结果` : '最近使用优先，也可直接输入搜索'}</p>
      <div ref={list} className="command-results" role="listbox" id={`${id}-list`} aria-label="命令搜索结果">
        {results.map((command, index) => <div role="option" id={`${id}-option-${index}`} key={command.id} aria-selected={index === active} className={`command-option ${index === active ? 'selected' : ''}`} onMouseEnter={() => setSelection(command.id)} onMouseDown={event => event.preventDefault()} onClick={() => execute(command)}><span className="command-option-group">{command.group}</span><span className="command-option-copy"><strong>{command.title}</strong>{command.hint && <small>{command.hint}</small>}</span>{!query && recent.includes(command.id) ? <Clock3 size={14} aria-label="最近使用" /> : <ArrowRight size={14} />}</div>)}
      </div>
      {!results.length && <p className="command-empty">没有找到匹配内容。试试“报告”“数据源”或更短的关键词。</p>}
    </div>
    <div className="modal-footer command-footer"><span>↑ ↓ 选择 · Enter 执行 · Esc 关闭</span><kbd>Ctrl / ⌘ K</kbd></div>
  </Modal>;
}
