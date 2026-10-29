import { useAppearance } from '../appearance-context';
import type { ThemePreference, ViewDensity } from '../appearance';
import { Modal } from './ui';
import type { KeyboardEvent } from 'react';

const themes: { value: ThemePreference; label: string }[] = [
  {value:'system',label:'跟随系统'}, {value:'light',label:'浅色'}, {value:'dark',label:'深色'},
];
const views: { value: ViewDensity; label: string }[] = [{value:'concise',label:'简洁版'}, {value:'standard',label:'正常版'}];
function moveSelection(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0 || !buttons.length) return;
  event.preventDefault(); const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]; next.focus(); next.click();
}
export function AppearanceControls() {
  const appearance = useAppearance();
  return <div className="appearance-controls">
    <fieldset><legend>主题</legend><div className="segmented appearance-segment" onKeyDown={moveSelection}>{themes.map(item => <button type="button" key={item.value} className={appearance.theme === item.value ? 'selected' : ''} aria-pressed={appearance.theme === item.value} onClick={() => appearance.setTheme(item.value)}>{item.label}</button>)}</div></fieldset>
    <fieldset><legend>视图密度</legend><div className="segmented appearance-segment" onKeyDown={moveSelection}>{views.map(item => <button type="button" key={item.value} className={appearance.view === item.value ? 'selected' : ''} aria-pressed={appearance.view === item.value} onClick={() => appearance.setView(item.value)}>{item.label}</button>)}</div><p>简洁版收紧布局，正常版展示更多说明；两者保留相同功能。</p></fieldset>
    <button type="button" className="button secondary" aria-pressed={appearance.railCollapsed} onClick={() => appearance.setRailCollapsed(!appearance.railCollapsed)}>{appearance.railCollapsed ? '展开侧栏' : '折叠侧栏'}</button>
  </div>;
}
export function AppearanceSettings({ close }: {close: () => void}) {
  return <Modal title="显示设置" subtitle="调整当前账号的主题和界面密度。" close={close}><div className="modal-body"><AppearanceControls /></div><div className="modal-footer"><span /><button className="button secondary" onClick={close}>关闭</button></div></Modal>;
}
