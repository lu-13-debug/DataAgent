import test from 'node:test';
import assert from 'node:assert/strict';
const parser = await import('./datasets.js').catch(() => ({}));

test('XLSX sheet inference maps Chinese columns and returns safe preview metadata', async () => {
  assert.equal(typeof parser.parseFiles, 'function', '必须提供 XLSX 解析');
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const users = workbook.addWorksheet('注册用户');
  users.addRows([['玩家ID', '注册日期', '来源渠道'], ['u1', new Date('2026-10-01T08:00:00Z'), '自然']]);
  const activity = workbook.addWorksheet('活动');
  activity.addRows([['用户ID', '事件时间'], ['u1', '2026-10-02 10:00:00']]);
  const dataset = await parser.parseFiles([{ originalname: 'analytics.xlsx', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) }]);
  assert.equal(dataset.tableCount, 2);
  assert.equal(dataset.rowCount, 2);
  assert.equal(dataset.records.users[0].user_id, 'u1');
  assert.equal(dataset.records.activity[0].event_time, '2026-10-02T02:00:00.000Z');
  assert.equal(parser.publicDataset(dataset).records, undefined);
});

test('parser rejects ambiguous tables, negative amounts, invalid time and conflicting orders', async () => {
  assert.equal(typeof parser.parseFiles, 'function');
  const file = text => [{ originalname: 'payments.csv', buffer: Buffer.from(text) }];
  const header = 'order_id,user_id,paid_at,amount,currency,status\n';
  await assert.rejects(parser.parseFiles(file(header + 'x,a,2026-10-01,-1,CNY,paid')), /金额/);
  await assert.rejects(parser.parseFiles(file(header + 'x,a,no-date,1,CNY,paid')), /时间/);
  await assert.rejects(parser.parseFiles(file(header + 'x,a,2026-10-01,1,CNY,paid\nx,a,2026-10-01,2,CNY,paid')), /冲突/);
});

test('parser accepts the documented 200000 row boundary without argument stack overflow', async () => {
  const csv = 'user_id,event_time\n' + Array.from({ length: 200000 }, (_, i) => `u${i},2026-10-01`).join('\n');
  const dataset = await parser.parseFiles([{ originalname: 'activity.csv', buffer: Buffer.from(csv) }]);
  assert.equal(dataset.rowCount, 200000);
});

for (const date1904 of [false, true]) {
  test(`native XLSX evening dates match Shanghai wall-clock CSV for all tables (date1904=${date1904})`, async () => {
    const { default: ExcelJS } = await import('exceljs');
    const { analyze } = await import('./analytics.js');
    const workbook = new ExcelJS.Workbook();
    workbook.properties.date1904 = date1904;
    const tables = {
      users: [
        ['user_id', 'registered_at', 'channel'],
        ['u1', '2026-10-01 20:00:00', '自然'],
        ['u2', '2026-10-02 23:40:00', '广告'],
      ],
      activity: [
        ['user_id', 'event_time'],
        ['u1', '2026-10-01 21:00:00'],
        ['u1', '2026-10-02 23:50:00'],
        ['u2', '2026-10-02 23:55:00'],
      ],
      payments: [
        ['order_id', 'user_id', 'paid_at', 'amount', 'currency', 'status'],
        ['p1', 'u1', '2026-10-01 22:00:00', '1.23', 'CNY', 'paid'],
        ['p2', 'u2', '2026-10-02 23:59:00', '5.67', 'CNY', 'paid'],
      ],
    };
    for (const [name, rows] of Object.entries(tables)) {
      const sheet = workbook.addWorksheet(name);
      sheet.addRow(rows[0]);
      const timeColumn = name === 'payments' ? 2 : 1;
      for (const values of rows.slice(1)) {
        const excelValues = [...values];
        // Excel serials carry calendar/time fields, without an absolute timezone.
        excelValues[timeColumn] = new Date(values[timeColumn].replace(' ', 'T') + 'Z');
        const row = sheet.addRow(excelValues);
        row.getCell(timeColumn + 1).numFmt = 'yyyy-mm-dd hh:mm:ss';
      }
    }
    const xlsx = await parser.parseFiles([{ originalname: 'evening.xlsx', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) }]);
    const csv = await parser.parseFiles(Object.entries(tables).map(([name, rows]) => ({ originalname: `${name}.csv`, buffer: Buffer.from(rows.map(row => row.join(',')).join('\n')) })));
    assert.deepEqual(xlsx.records, csv.records);
    assert.deepEqual(xlsx.dateRange, { start: '2026-10-01', end: '2026-10-02' });
    const report = analyze(xlsx, { now: '2026-10-05T00:00:00Z' });
    assert.deepEqual(report.daily, [
      { date: '2026-10-01', dau: 1, newUsers: 1, revenue: 1.23, payers: 1 },
      { date: '2026-10-02', dau: 2, newUsers: 1, revenue: 5.67, payers: 1 },
    ]);
    assert.equal(report.retention[0].d1, 100);
  });
}

test('XLSX explicit ISO Z and offset strings keep their absolute timestamp meaning', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('activity').addRows([
    ['user_id', 'event_time'],
    ['native', new Date('2026-10-01T20:00:00Z')],
    ['utc', '2026-10-01T20:00:00Z'],
    ['offset', '2026-10-01T20:00:00-04:00'],
    ['shanghai', '2026-10-01T20:00:00+08:00'],
  ]);
  const dataset = await parser.parseFiles([{ originalname: 'explicit.xlsx', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) }]);
  const times = Object.fromEntries(dataset.records.activity.map(row => [row.user_id, row.event_time]));
  assert.equal(times.native, '2026-10-01T12:00:00.000Z');
  assert.equal(times.utc, '2026-10-01T20:00:00.000Z');
  assert.equal(times.offset, '2026-10-02T00:00:00.000Z');
  assert.equal(times.shanghai, '2026-10-01T12:00:00.000Z');
});
