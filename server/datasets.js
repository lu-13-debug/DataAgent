import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { SCHEMA, normalizeRecords, dateOf, shiftDate, yesterday } from './analytics.js';

const MAX_ROWS = 200000;
const aliases = {
  user_id: ['user_id', 'userid', 'uid', '用户id', '用户编号', '玩家id', '玩家编号', '用户标识'],
  registered_at: ['registered_at', 'registeredat', 'register_time', 'registration_time', '注册时间', '注册日期', '创建时间'],
  channel: ['channel', '渠道', '来源渠道', '注册渠道', '渠道来源'],
  event_time: ['event_time', 'eventtime', 'active_time', 'activity_time', '事件时间', '活跃时间', '活动时间', '登录时间', '日期'],
  order_id: ['order_id', 'orderid', '订单id', '订单号', '订单编号'],
  paid_at: ['paid_at', 'paidat', 'pay_time', 'payment_time', '支付时间', '付款时间'],
  amount: ['amount', '金额', '支付金额', '付款金额', '实付金额'],
  currency: ['currency', '币种', '货币', '货币代码'],
  status: ['status', '状态', '支付状态', '订单状态'],
};
const cleanHeader = text => String(text ?? '').trim().replace(/^\uFEFF/, '').toLowerCase().replaceAll(' ', '');
const aliasMap = new Map(Object.entries(aliases).flatMap(([key, list]) => list.map(x => [cleanHeader(x), key])));
const typesByName = name => {
  const value = name.toLowerCase();
  if (/payment|order|支付|付款|订单/.test(value)) return 'payments';
  if (/activity|active|event|活跃|活动|事件|登录/.test(value)) return 'activity';
  if (/user|register|用户|注册|玩家/.test(value)) return 'users';
  return null;
};
function tableFromRows(name, matrix) {
  if (!matrix.length) throw new Error(`${name} 是空表`);
  const columns = matrix[0].map(h => aliasMap.get(cleanHeader(h)) || cleanHeader(h));
  if (new Set(columns).size !== columns.length) throw new Error(`${name} 含重复列名或映射后重复的列`);
  const candidates = Object.entries(SCHEMA).filter(([, required]) => required.filter(k => k !== 'channel').every(k => columns.includes(k))).map(([type]) => type);
  const named = typesByName(name);
  const type = named && candidates.includes(named) ? named : candidates.length === 1 ? candidates[0] : null;
  if (!type) throw new Error(`${name} 无法识别标准表类型。请提供 users(user_id,registered_at,channel)、activity(user_id,event_time) 或 payments(order_id,user_id,paid_at,amount,currency,status)`);
  const rows = [];
  for (const values of matrix.slice(1)) {
    if (values.every(v => v === '' || v === null || v === undefined)) continue;
    const row = {};
    for (const key of SCHEMA[type]) { const idx = columns.indexOf(key); row[key] = idx < 0 ? '未标记渠道' : values[idx]; }
    rows.push(row);
  }
  if (!rows.length) throw new Error(`${name} 没有数据行`);
  return { type, rows };
}
function excelValue(cell) {
  const value = cell.value;
  // Excel has no timezone. ExcelJS has already resolved the 1900/1904 epoch;
  // its UTC fields represent the displayed wall clock, which belongs to Shanghai.
  // Only native date cells are reinterpreted; explicit ISO strings retain their zone.
  if (value instanceof Date) return value.toISOString().replace(/Z$/, '+08:00');
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('formula' in value || 'sharedFormula' in value) throw new Error('不接受公式单元格，请将公式转换为值后上传');
    if ('richText' in value) return value.richText.map(x => x.text).join('');
    if ('text' in value) return value.text;
    throw new Error('表格含不支持的单元格类型，请转换为纯文本或数值');
  }
  return value ?? '';
}
export function createDataset(records, { name = '上传数据', source = 'upload', warnings = [], now = new Date() } = {}) {
  const normalized = normalizeRecords(records, warnings);
  const all = Object.values(records).flat();
  if (all.length > MAX_ROWS) throw new Error('解析后最多支持 200000 行数据');
  const dates = Object.entries(normalized.records).flatMap(([type, rows]) => rows.map(x => dateOf(x[type === 'users' ? 'registered_at' : type === 'activity' ? 'event_time' : 'paid_at']))).sort();
  if (!dates.length) throw new Error('没有可分析的数据行');
  const tables = Object.entries(normalized.records).map(([type, rows]) => ({ name: type, type, columns: SCHEMA[type], rowCount: rows.length, preview: rows.slice(0, 5) }));
  return { id: randomUUID(), name, source, createdAt: new Date(now).toISOString(), rowCount: all.length, tableCount: tables.length, tables, warnings: normalized.warnings, dateRange: { start: dates[0], end: dates.at(-1) }, channelCount: new Set((normalized.records.users || []).map(u => u.channel)).size, records: normalized.records };
}
export function publicDataset(dataset) { const { records, ...safe } = dataset; return safe; }

export async function parseFiles(files) {
  if (!files?.length) throw new Error('请选择 1 至 3 个 CSV / XLSX 文件');
  if (files.length > 3) throw new Error('最多上传 3 个文件');
  if (files.reduce((n, f) => n + f.buffer.length, 0) > 20 * 1024 * 1024) throw new Error('文件总大小不能超过 20MB');
  const records = {};
  let rowCount = 0;
  for (const file of files) {
    const name = path.basename(file.originalname).replace(/[\x00-\x1f]/g, '').slice(0, 100);
    const ext = path.extname(name).toLowerCase();
    const append = (label, matrix) => {
      const { type, rows } = tableFromRows(label, matrix);
      rowCount += rows.length;
      if (rowCount > MAX_ROWS) throw new Error('解析后最多支持 200000 行数据');
      const target = records[type] ||= [];
      for (const row of rows) target.push(row);
    };
    if (ext === '.csv') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
      let matrix;
      try { matrix = parse(text, { bom: true, skip_empty_lines: true, trim: true, relax_column_count: false, max_record_size: 1024 * 1024 }); }
      catch { throw new Error(`${name} CSV 格式无效，请检查列数、引号并使用 UTF-8 编码`); }
      append(name, matrix);
    } else if (ext === '.xlsx') {
      // Inspect ZIP central directory before decompression to reject oversized workbook bombs.
      let totalUncompressed = 0;
      const buf = file.buffer;
      for (let i = 0; i + 46 <= buf.length; i++) if (buf.readUInt32LE(i) === 0x02014b50) {
        totalUncompressed += buf.readUInt32LE(i + 24);
        if (totalUncompressed > 100 * 1024 * 1024) throw new Error('XLSX 解压后超过 100MB，请缩小文件');
        i += 45 + buf.readUInt16LE(i + 28) + buf.readUInt16LE(i + 30) + buf.readUInt16LE(i + 32);
      }
      let workbook;
      try { workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buf); }
      catch { throw new Error(`${name} 无法读取，请上传有效 XLSX 工作簿`); }
      if (workbook.worksheets.length > 10) throw new Error('工作簿最多支持 10 个工作表');
      for (const sheet of workbook.worksheets) {
        if (!sheet.actualRowCount) continue;
        if (sheet.rowCount > MAX_ROWS + 1) throw new Error('解析后最多支持 200000 行数据');
        const matrix = [];
        sheet.eachRow({ includeEmpty: false }, row => { matrix.push(Array.from({ length: sheet.columnCount }, (_, i) => excelValue(row.getCell(i + 1)))); });
        append(sheet.name, matrix);
      }
    } else throw new Error('仅支持 CSV 与 XLSX 文件');
  }
  return createDataset(records, { name: files.length === 1 ? path.basename(files[0].originalname).replace(/\.[^.]+$/, '').slice(0, 100) : `${files.length} 个文件 · 运营数据` });
}

export function generateDemo(now = new Date()) {
  const fixedEnd = '2026-10-22';
  const end = yesterday(now) < fixedEnd ? yesterday(now) : fixedEnd;
  const start = shiftDate(end, -27);
  const records = { users: [], activity: [], payments: [] };
  let state = 1731;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  const channels = ['自然流量', '巨量引擎', '腾讯广告', '社区推荐'];
  let order = 0;
  for (let day = 0; day < 28; day++) {
    const date = shiftDate(start, day);
    const newCount = 38 + Math.floor(day * 1.4) + Math.floor(rand() * 18);
    for (let j = 0; j < newCount; j++) records.users.push({ user_id: `demo_${day}_${j}`, registered_at: `${date}T09:00:00+08:00`, channel: channels[Math.floor(rand() * channels.length)] });
    for (const user of records.users) {
      const age = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${dateOf(user.registered_at)}T00:00:00Z`)) / 86400000);
      const chance = age === 0 ? 0.92 : 0.5 * Math.exp(-age / 16) + 0.08;
      if (rand() > chance) continue;
      records.activity.push({ user_id: user.user_id, event_time: `${date}T15:20:00+08:00` });
      if (rand() < 0.08 + day / 2000) records.payments.push({ order_id: `demo_order_${++order}`, user_id: user.user_id, paid_at: `${date}T18:30:00+08:00`, amount: [6, 18, 30, 68, 128][Math.floor(rand() * 5)], currency: 'CNY', status: 'success' });
    }
  }
  return createDataset(records, { name: '星河远征 · 28 天演示数据', source: 'demo', now, warnings: ['确定性生成的示例数据，仅用于产品演示，不代表真实业务'] });
}
