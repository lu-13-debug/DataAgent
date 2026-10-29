import { ArrowRight, Check, X } from 'lucide-react';
import type { OnboardingProgress } from '../onboarding';
import { useAppearance } from '../appearance-context';

export function OnboardingChecklist({ progress, onSample, onData, onCreate, dismiss, hasSample }: {
  progress: OnboardingProgress; onSample: () => void; onData: () => void; onCreate: () => void; dismiss: () => void; hasSample: boolean;
}) {
  const { view } = useAppearance();
  const items = [
    { title: '看示例报告', detail: '先看指标、发现与建议，阅读不扣额度。', done: progress.viewedSample, action: onSample, label: hasSample ? '用示例数据看一份报告' : '查看示例使用说明' },
    { title: '上传或选择数据', detail: '支持 CSV / Excel，也可选择示例数据。', done: progress.selectedData, action: onData, label: '选择分析数据' },
    { title: '生成第一份报告', detail: '确认范围后开始，每次消耗 20 服务额度。', done: progress.generatedReport, action: onCreate, label: '生成第一份报告' },
  ];
  const steps = <>
    <div className="onboarding-heading"><div><h2>三步，完成你的第一次分析</h2><p>先读示例，再用自己的数据得到一份报告。</p></div><button className="icon-button" onClick={dismiss} aria-label="关闭三步清单"><X size={18} /></button></div>
    <ol>{items.map((item, index) => <li key={item.title} className={item.done ? 'is-complete' : ''}><span className="onboarding-step" aria-hidden="true">{item.done ? <Check size={15} /> : index + 1}</span><div><h3>{item.title}<span className="sr-only">{item.done ? '，已完成' : '，待完成'}</span></h3><p>{item.detail}</p><button className={`button ${index === 0 && !progress.viewedSample ? 'primary' : 'secondary'}`} onClick={item.action}>{item.label}<ArrowRight size={13} /></button></div></li>)}</ol>
  </>;
  return <section className="onboarding-checklist no-print" aria-label="开始使用三步清单">
    {view === 'concise' ? <details className="onboarding-compact"><summary>已完成 {items.filter(item => item.done).length}/3 · <span>继续设置</span></summary>{steps}</details> : steps}
  </section>;
}
