import type { Task } from '../types';
import { compareReports } from '../report-assets';
import { Modal, number } from './ui';
export function ReportComparison({ left, right, close }: { left: Task; right: Task; close: () => void }) {
  const comparison = compareReports(left, right);
  return <Modal title="报告对比" subtitle="只比较可确认的数值；差值为报告 B 减报告 A。" close={close} wide>
    <div className="modal-body report-comparison">
      <div className="comparison-sources"><div><span>报告 A</span><strong>{left.title}</strong><p>{left.datasetName} · {left.report?.period}</p></div><div><span>报告 B</span><strong>{right.title}</strong><p>{right.datasetName} · {right.report?.period}</p></div></div>
      {!comparison.comparable && <section className="comparison-warning" role="note"><h3>不可直接比较</h3><ul>{comparison.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><p>下方只并排展示原报告数值，不计算差值，也不据此推断变化。</p></section>}
      <div className="comparison-rows">{comparison.rows.map(row => <section className="comparison-row" key={row.id}><h3>{row.label}</h3><div><span>报告 A</span><strong>{number(row.left, 2)} {row.left === null ? '' : row.leftUnit}</strong></div><div><span>报告 B</span><strong>{number(row.right, 2)} {row.right === null ? '' : row.rightUnit}</strong></div><p>{row.difference === null ? comparison.comparable ? '缺少有效数值，不计算差值' : '不可直接比较' : `差值：${row.difference > 0 ? '+' : ''}${number(row.difference, 2)} ${row.differenceUnit}`}</p></section>)}</div>
    </div><div className="modal-footer"><span className="subtle-label">数据缺失不等同于零</span><button className="button primary" onClick={close}>返回报告列表</button></div>
  </Modal>;
}
