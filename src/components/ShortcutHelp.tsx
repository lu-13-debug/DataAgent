import { Modal } from './ui';
const shortcuts = [
  ['Ctrl / ⌘ + K', '打开或关闭命令面板'], ['Ctrl / ⌘ + Shift + D', '打开显示设置'], ['N', '新建分析（编辑文本时不触发）'], ['?', '查看快捷键（编辑文本时不触发）'], ['Esc', '关闭可关闭的弹窗或展开面板'],
  ['↑ / ↓', '在命令面板中选择结果'], ['Enter', '执行选中命令；在向导输入步骤进入下一步'], ['Shift + Enter', '在多行输入框换行'], ['Tab / Shift + Tab', '在弹窗内向前或向后移动焦点'],
];
export function ShortcutHelp({ close }: { close: () => void }) {
  return <Modal title="快捷键" subtitle="输入法组字期间不会触发快捷操作；收费分析仍需在摘要页明确确认。" close={close}><div className="modal-body"><dl className="shortcut-list">{shortcuts.map(([key, action]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{action}</dd></div>)}</dl></div><div className="modal-footer"><span /><button className="button primary" onClick={close}>返回工作台</button></div></Modal>;
}
