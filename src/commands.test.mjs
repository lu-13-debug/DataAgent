import test from 'node:test';
import assert from 'node:assert/strict';
const commands = await import('./commands.ts').catch(() => ({}));
const items = [{ id: 'page:reports', title: '分析报告', group: '页面', keywords: 'reports' }, { id: 'task:a', title: '渠道质量复盘', group: '报告' }, { id: 'action:new', title: '新建分析', group: '动作' }];
test('commands match Chinese fuzzy subsequences and English aliases, with useful empty results', () => {
  assert.equal(typeof commands.searchCommands, 'function');
  assert.deepEqual(commands.searchCommands(items, '渠复', []).map(item => item.id), ['task:a']);
  assert.deepEqual(commands.searchCommands(items, 'REPORT', []).map(item => item.id), ['page:reports']);
  assert.deepEqual(commands.searchCommands(items, '不存在的命令', []), []);
  assert.equal(commands.searchCommands(items, '', ['action:new'])[0].id, 'action:new');
});
test('command history stores only bounded IDs and isolates user, runtime and service', () => {
  assert.equal(typeof commands.commandStorageKey, 'function');
  const key = commands.commandStorageKey('cloud', 'a', 'https://a.test');
  assert.notEqual(key, commands.commandStorageKey('cloud', 'b', 'https://a.test'));
  assert.notEqual(key, commands.commandStorageKey('local', 'a', 'https://a.test'));
  assert.notEqual(key, commands.commandStorageKey('cloud', 'a', 'https://b.test'));
  const data = new Map(); const storage = { getItem: name => data.get(name), setItem: (name, value) => data.set(name, value) };
  commands.rememberCommand(storage, key, 'action:new'); commands.rememberCommand(storage, key, 'page:reports'); commands.rememberCommand(storage, key, 'action:new');
  assert.deepEqual(commands.readRecentCommands(storage, key), ['action:new', 'page:reports']);
  for (let i = 0; i < 30; i++) commands.rememberCommand(storage, key, `task:${i}`);
  assert.equal(commands.readRecentCommands(storage, key).length, 12);
  assert.deepEqual(commands.readRecentCommands({ getItem() { throw Error('disabled'); } }, key), []);
});
test('shortcuts ignore IME, text entry, repeats and nested dialogs while Cmd/Ctrl K remains available', () => {
  assert.equal(typeof commands.shortcutAction, 'function');
  const base = { key: 'n', target: { tagName: 'BODY' } };
  assert.equal(commands.shortcutAction(base, false), 'new');
  assert.equal(commands.shortcutAction({ ...base, target: { tagName: 'INPUT' } }, false), null);
  assert.equal(commands.shortcutAction({ ...base, target: { isContentEditable: true } }, false), null);
  assert.equal(commands.shortcutAction({ ...base, isComposing: true }, false), null);
  assert.equal(commands.shortcutAction({ ...base, keyCode: 229 }, false), null);
  assert.equal(commands.shortcutAction({ ...base, repeat: true }, false), null);
  assert.equal(commands.shortcutAction(base, true), null);
  assert.equal(commands.shortcutAction({ ...base, key: 'k', ctrlKey: true, target: { tagName: 'INPUT' } }, false), 'commands');
  assert.equal(commands.shortcutAction({ ...base, key: 'k', metaKey: true }, true, true), 'commands');
  assert.equal(commands.shortcutAction({ ...base, key: '?' }, false), 'shortcuts');
});
test('live command insertion keeps the selected ID rather than executing the previous array index', () => {
  assert.equal(typeof commands.selectedCommandIndex, 'function');
  const selected = 'task:a';
  assert.equal(commands.selectedCommandIndex(items, selected), 1);
  const live = [{ id: 'action:export', title: '导出当前报告', group: '动作' }, ...items];
  assert.equal(commands.selectedCommandIndex(live, selected), 2);
  assert.equal(live[commands.selectedCommandIndex(live, selected)].id, selected);
  assert.equal(commands.selectedCommandIndex(live, 'deleted'), 0);
  assert.equal(commands.selectedCommandIndex([], selected), -1);
});
