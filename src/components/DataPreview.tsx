import { useState } from 'react';
import { ArrowRight, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import type { Dataset } from '../types';
import { useAuth } from '../auth-context';
import { profileColumn, searchPreview } from '../data-inspection';
import { DatasetInspection } from './DatasetInspection';
import { Modal, number } from './ui';

export function DataPreview({ dataset, close, onAnalyze }: { dataset: Dataset; close: () => void; onAnalyze: () => void }) {
  const { runtime } = useAuth(); const [index, setIndex] = useState(0); const [column, setColumn] = useState(''); const [query, setQuery] = useState(''); const [confirmed, setConfirmed] = useState(dataset.source === 'demo');
  const table = dataset.tables[index]; const rows = table ? searchPreview(table.preview, column, query) : [];
  return <Modal title={dataset.name} subtitle={`${number(dataset.rowCount)} 条原始记录 · ${dataset.tableCount} 张数据表`} close={close} wide>
    <div className="modal-body dataset-preview-body"><h3>识别结果确认</h3><DatasetInspection dataset={dataset} />
      <div className="preview-heading"><h3>预览样本</h3><span className="tiny-tag">仅当前预览样本，非全量统计</span></div>
      <div className="tabs data-preview-tabs">{dataset.tables.map((item, itemIndex) => <button className={index === itemIndex ? 'selected' : ''} key={item.name + itemIndex} onClick={() => { setIndex(itemIndex); setColumn(''); setQuery(''); }}><FileSpreadsheet size={14} />{item.name}<span>{number(item.rowCount)}</span></button>)}</div>
      {table && <><div className="preview-search"><label>搜索列<select aria-label="选择预览搜索列" value={column} onChange={event => setColumn(event.target.value)}><option value="">全部列</option>{table.columns.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>搜索样本<input aria-label="搜索预览样本" value={query} onChange={event => setQuery(event.target.value)} placeholder="仅搜索当前预览行" /></label></div><div className="table-scroll preview-table"><table className="data-table"><thead><tr>{table.columns.map(name => { const profile = profileColumn(table.preview, name); return <th key={name}>{name}<small>{profile.type} · 样本空值率 {profile.emptyRate == null ? '未知' : profile.emptyRate + '%'}</small></th>; })}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{table.columns.map(name => <td key={name}>{String(row[name] ?? '—')}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="inline-empty">没有匹配的预览样本，请调整搜索。</p>}</div></>}
      <p className="field-help">仅对服务返回的前 {table?.preview.length || 0} 行计算类型、空值率并搜索，不加载全量记录。</p>
      <label className="confirm-recognition"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已核对识别结果与缺表影响</label>
    </div>
    <div className="modal-footer"><span className="subtle-label"><ShieldCheck size={13} />{runtime.mode === 'cloud' ? '当前账号的服务器数据' : '本机数据'}</span><button className="button primary" disabled={!confirmed || dataset.inspection?.analyzable === false} onClick={onAnalyze}>使用这份数据分析<ArrowRight size={15} /></button></div>
  </Modal>;
}
