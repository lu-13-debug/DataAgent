import type { Dataset } from './types';

export const tableLabels: Record<string, string> = { users: '玩家注册表', activity: '活跃事件表', payments: '支付订单表' };
const metricLabels: Record<string, string> = { dau: '日活跃玩家', new_users: '新增玩家', d1_retention: '次日留存率', d7_retention: '7日留存率', channels: '渠道表现', revenue: '成功支付收入', arppu: 'ARPPU', payers: '付费人数', pay_rate: '活跃付费率', arpdau: 'ARPDAU' };
export const metricLabel = (id: string) => metricLabels[id] || id;
export function missingTableImpacts(types: string[]) {
  const result: string[] = [];
  if (!types.includes('users')) result.push('缺 users：新增、注册渠道及注册留存不可计算。');
  if (!types.includes('activity')) result.push('缺 activity：DAU、留存、活跃付费率及 ARPDAU 不可计算。');
  if (!types.includes('payments')) result.push('缺 payments：收入、ARPPU、付费人数不可计算。');
  return result;
}
export function datasetSummary(dataset: Pick<Dataset, 'tables' | 'inspection'> & Partial<Pick<Dataset, 'rowCount' | 'dateRange'>>) {
  const metadata = dataset.inspection;
  return {
    recorded: Boolean(metadata), score: metadata?.quality.score ?? null,
    rawRows: metadata?.rawRows ?? dataset.rowCount ?? 0, validRows: metadata?.validRows ?? null,
    missing: metadata?.missingTables || Object.keys(tableLabels).filter(type => !dataset.tables.some(table => table.type === type)),
    analyzable: metadata?.analyzable !== false,
  };
}
const empty = (value: unknown) => value == null || String(value).trim() === '';
export function profileColumn(rows: Record<string, unknown>[], column: string) {
  const values = rows.map(row => row[column]).filter(value => !empty(value));
  const typeOf = (value: unknown) => {
    if (typeof value === 'boolean') return '布尔';
    const text = String(value).trim();
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T ].*)?$/.test(text) && Number.isFinite(Date.parse(text))) return '日期时间';
    if (!/(?:^|_)id$/i.test(column) && /^[-+]?\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text))) return '数值';
    return '文本';
  };
  const types = new Set(values.map(typeOf));
  return { type: !values.length ? '无有效样本' : types.size > 1 ? '混合' : [...types][0], emptyRate: rows.length ? Math.round((rows.length - values.length) / rows.length * 100) : null, sampleSize: rows.length };
}
export function searchPreview(rows: Record<string, unknown>[], column: string, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? rows.filter(row => (column ? [row[column]] : Object.values(row)).some(value => String(value ?? '').toLocaleLowerCase().includes(needle))) : rows;
}
export function pasteToCsv(input: string) {
  if (new TextEncoder().encode(input).length > 20 * 1024 * 1024) throw new Error('粘贴内容不能超过 20MB。');
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false; let closed = false;
  const cell = () => { row.push(value); value = ''; closed = false; };
  const line = () => { cell(); rows.push(row); row = []; if (rows.length > 200001) throw new Error('最多支持 200000 行数据。'); };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index++; }
      else if (character === '"') { quoted = false; closed = true; }
      else value += character;
    } else if (character === '\t') cell();
    else if (character === '\n') line();
    else if (character === '"' && !value && !closed) quoted = true;
    else if (closed || character === '"') throw new Error('引号格式无效，请重新从表格复制。');
    else value += character;
  }
  if (quoted) throw new Error('引号未闭合，请完整复制表格。');
  if (value || row.length || closed) line();
  while (rows.length && rows.at(-1)!.every(item => !item.trim())) rows.pop();
  if (rows.length < 2) throw new Error('请同时粘贴表头和至少一条数据行。');
  const width = rows[0].length;
  if (width < 2 || rows.some(values => values.length !== width)) throw new Error('表头与数据列数不一致，请完整复制表格。');
  return rows.map(values => values.map(item => /[,"\n\t]/.test(item) ? `"${item.replaceAll('"', '""')}"` : item).join(',')).join('\r\n');
}
