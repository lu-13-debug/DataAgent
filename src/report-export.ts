import type { ExploreScope, Report } from './types';

export type ReportCsvKind = 'metrics' | 'channels' | 'retention' | 'daily';
type ExportScope = Pick<ExploreScope, 'start' | 'end' | 'channels'>;
export function csvCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value);
  // Only strings receive an apostrophe. Real negative numbers remain numeric.
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function reportCsv(report: Report, kind: ReportCsvKind, scope?: ExportScope, tableFilterNote = '') {
  const range = scope || { start: report.daily[0]?.date || '', end: report.daily.at(-1)?.date || '', channels: [] };
  const contextHeaders = ['当前开始日', '当前结束日', '注册渠道筛选', '来源说明', '表内筛选说明'];
  const context = [range.start, range.end, range.channels.length ? range.channels.join('、') : '全部渠道', scope ? '确定性派生；无数据留空；不含批注' : '原始报告；无数据留空；不含批注', tableFilterNote];
  let headers: unknown[], rows: unknown[][];
  if (kind === 'metrics') {
    headers = ['指标', '数值', '单位', '统计口径'];
    rows = report.metrics.map(metric => [metric.label, metric.value, metric.unit, metric.note]);
  } else if (kind === 'channels') {
    headers = ['注册渠道', '新增玩家', '归属玩家支付收入', '成熟群体次日留存(%)', '币种', '数据说明'];
    rows = report.channels.map(channel => [channel.name, channel.users, channel.revenue, channel.d1, report.currency, channel.users == null || channel.revenue == null || channel.d1 == null ? '空值表示覆盖不足、观察期不足或原任务跳过；请查统计口径并补齐源数据' : '']);
  } else if (kind === 'retention') {
    headers = ['注册日期', '新增玩家', '次日留存(%)', '七日留存(%)'];
    rows = report.retention.map(cohort => [cohort.date, cohort.users, cohort.d1, cohort.d7]);
  } else {
    headers = ['日期', '活跃玩家', '新增玩家', '支付收入', '付费玩家', '币种'];
    rows = report.daily.map(day => [day.date, day.dau, day.newUsers, day.revenue, day.payers, report.currency]);
  }
  const body = rows.length ? rows : [Array(headers.length).fill(null)];
  return [[...headers, ...contextHeaders], ...body.map(row => [...row, ...context])].map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function exportFilename(title: string, start: string, end: string, kind: string, extension: 'csv' | 'png') {
  let name = title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name)) name = `_${name}`;
  name = [...name].slice(0, 100).join('') || '报告';
  return `${name}_${start}_${end}_${kind}.${extension}`;
}

/** Rasterize the current local SVG. No network fonts, remote images or raw records. */
export async function exportTrendPng(svg: SVGSVGElement, filename: string) {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', '1200'); copy.setAttribute('height', '500');
  copy.setAttribute('font-family', 'Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif');
  copy.style.background = '#ffffff';
  const source = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml;charset=utf-8' }));
  let output = '';
  try {
    const picture = new Image();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('趋势图转为图片超时，请改用每日数据 CSV 或打印 / PDF。')), 10000);
      picture.onload = () => { clearTimeout(timer); resolve(); };
      picture.onerror = () => { clearTimeout(timer); reject(new Error('趋势图转为图片失败，请改用每日数据 CSV 或打印 / PDF。')); };
      picture.src = source;
    });
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1000;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('此浏览器无法生成 PNG，请改用每日数据 CSV 或打印 / PDF。');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 编码失败，请改用 CSV 或打印 / PDF。')), 'image/png'));
    output = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = output; anchor.download = filename; anchor.click();
    const saved = output; output = ''; setTimeout(() => URL.revokeObjectURL(saved), 1000);
  } finally { URL.revokeObjectURL(source); if (output) URL.revokeObjectURL(output); }
}
