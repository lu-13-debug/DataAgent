import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseFiles, createDataset, publicDataset, generateDemo } from './datasets.js';
import { analyze } from './analytics.js';

const csv = (name, text) => ({ originalname: name, buffer: Buffer.from(text) });

test('Chinese CSV inspection preserves source mapping, full counts, duplicate locations and missing-table impact', async () => {
  const dataset = await parseFiles([csv('注册用户.csv', '用户ID,注册时间\nprivate-player,2026-10-01\n\nprivate-player,2026-10-02\nb,2026-10-03\nc,2026-10-04\nd,2026-10-05\ne,2026-10-06\ng,2026-10-07\nf,2026-10-20\n')]);
  const inspection = dataset.inspection;
  assert.ok(inspection, '上传应返回 inspection');
  assert.equal(inspection.version, 1);
  assert.equal(dataset.rowCount, 8, '原公开行数仍为去重前行数');
  assert.equal(inspection.rawRows, 8);
  assert.equal(inspection.validRows, 7);
  assert.equal(dataset.tables[0].preview.length, 5);
  assert.deepEqual(inspection.coverage, [{ table: 'users', start: '2026-10-01', end: '2026-10-20', validRows: 7 }]);
  assert.deepEqual(inspection.mappings.find(m => m.field === 'user_id'), { table: 'users', source: '注册用户.csv', field: 'user_id', sourceColumn: '用户ID', origin: 'automatic', required: true });
  assert.deepEqual(inspection.mappings.find(m => m.field === 'channel'), { table: 'users', source: '注册用户.csv', field: 'channel', sourceColumn: null, origin: 'generated', required: false });
  assert.deepEqual(inspection.missingTables, ['activity', 'payments']);
  const duplicate = inspection.issues.find(issue => issue.code === 'duplicate_users');
  assert.deepEqual(duplicate.location, { table: 'users', column: '用户ID', rows: [2, 4] });
  assert.ok(duplicate.problem && duplicate.fix && duplicate.metrics.includes('new_users'));
  const payment = inspection.issues.find(issue => issue.code === 'missing_payments');
  assert.ok(['revenue', 'arppu', 'payers'].every(metric => payment.metrics.includes(metric)));
  assert.match(payment.problem, /收入.*ARPPU.*付费人数/);
  assert.equal(inspection.quality.score, analyze(dataset).quality.score);
  assert.match(inspection.quality.rule, /5/);
  assert.equal(inspection.analyzable, true);
  assert.equal(JSON.stringify(inspection).includes('private-player'), false);
  assert.equal(Object.hasOwn(publicDataset(dataset), 'records'), false);
});

test('XLSX inspection retains workbook and sheet mapping with actual worksheet row numbers', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('注册明细');
  sheet.addRow(['玩家编号', '注册日期', '注册渠道']);
  sheet.getRow(3).values = ['secret-xlsx-player', '2026-10-01', '自然'];
  sheet.getRow(7).values = ['secret-xlsx-player', '2026-10-02', '自然'];
  const dataset = await parseFiles([{ originalname: '业务.xlsx', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) }]);
  assert.ok(dataset.inspection, 'XLSX 应携带识别证据');
  assert.deepEqual(dataset.inspection.mappings.find(m => m.field === 'registered_at'), { table: 'users', source: '业务.xlsx / 注册明细', field: 'registered_at', sourceColumn: '注册日期', origin: 'automatic', required: true });
  assert.deepEqual(dataset.inspection.issues.find(issue => issue.code === 'duplicate_users').location.rows, [3, 7]);
  assert.equal(dataset.inspection.rawRows, 2);
  assert.equal(dataset.inspection.validRows, 1);
  assert.equal(JSON.stringify(dataset.inspection).includes('secret-xlsx-player'), false);
});

test('future-only records upload with unavailable analysis score and complete coverage', async () => {
  const dataset = await parseFiles([csv('activity.csv', 'user_id,event_time\nfuture-player,2099-01-01\n')]);
  assert.equal(dataset.inspection?.analyzable, false);
  assert.equal(dataset.inspection.quality.score, null);
  assert.deepEqual(dataset.inspection.coverage, [{ table: 'activity', start: '2099-01-01', end: '2099-01-01', validRows: 1 }]);
  assert.deepEqual(dataset.inspection.issues.find(issue => issue.code === 'incomplete_day').location, { table: 'activity', column: 'event_time', rows: [2] });
});

test('mixed historical and future rows retain full counts and use actual analyzer quality score', () => {
  const dataset = createDataset({ activity: [{ user_id: 'a', event_time: '2026-10-01' }, { user_id: 'b', event_time: '2099-01-01' }] }, { now: '2026-10-25T00:00:00Z' });
  assert.equal(dataset.inspection?.analyzable, true);
  assert.equal(dataset.inspection.validRows, 2);
  assert.equal(dataset.inspection.coverage[0].end, '2099-01-01');
  assert.equal(dataset.inspection.quality.score, analyze(dataset, { now: '2026-10-25T00:00:00Z' }).quality.score);
  assert.equal(dataset.inspection.issues.some(issue => issue.code === 'incomplete_day'), true);
  assert.deepEqual(dataset.inspection.mappings, [], '缺少解析来源时不得假造源映射');
});

test('generated demo is explicitly generated and old public datasets do not invent inspection', () => {
  const demo = generateDemo('2026-10-25T00:00:00Z');
  assert.ok(demo.inspection?.mappings.length);
  assert.ok(demo.inspection.mappings.every(mapping => mapping.origin === 'generated' && mapping.sourceColumn === null));
  const { inspection, ...legacy } = demo;
  assert.equal(Object.hasOwn(publicDataset(legacy), 'inspection'), false);
});

test('missing required columns and conflicting duplicate orders return structured locations without raw IDs', async () => {
  await assert.rejects(parseFiles([csv('payments.csv', '订单号,用户ID,支付时间,金额,币种\norder-private,player-private,2026-10-01,1,CNY\n')]), error => {
    assert.match(error.message, /无法识别标准表类型/);
    assert.equal(error.issues?.[0]?.code, 'missing_required_field');
    assert.deepEqual(error.issues[0].location, { table: 'payments', column: 'status' });
    return true;
  });
  await assert.rejects(parseFiles([csv('payments.csv', '订单号,用户ID,支付时间,金额,币种,状态\norder-private,player-private,2026-10-01,1,CNY,paid\norder-private,player-private,2026-10-01,2,CNY,paid\n')]), error => {
    assert.match(error.message, /重复订单.*冲突/);
    assert.equal(JSON.stringify({ error: error.message, issues: error.issues }).includes('private'), false);
    assert.equal(error.issues?.[0]?.code, 'conflicting_orders');
    assert.deepEqual(error.issues[0].location, { table: 'payments', column: '订单号', rows: [2, 3] });
    return true;
  });
});

test('duplicate activity records identify source lines while preserving raw valid events', async () => {
  const dataset = await parseFiles([csv('activity.csv', '用户ID,登录时间\nprivate-event-player,2026-10-01 23:00\nprivate-event-player,2026-10-01T15:00:00Z\n')]);
  assert.deepEqual(dataset.inspection.issues.find(issue => issue.code === 'duplicate_activity')?.location, { table: 'activity', column: '登录时间', rows: [2, 3] });
  assert.equal(dataset.inspection.validRows, 2, '有效行数不应改写既有事件保存语义');
  assert.equal(JSON.stringify(dataset.inspection).includes('private-event-player'), false);
});

test('invalid payment amounts point to the original source column and physical row', async () => {
  await assert.rejects(parseFiles([csv('payments.csv', '订单号,用户ID,支付时间,金额,币种,状态\n\nprivate-order,private-player,2026-10-01,-2,CNY,paid\n')]), error => {
    assert.match(error.message, /金额/);
    assert.deepEqual(error.issues?.[0]?.location, { table: 'payments', column: '金额', rows: [3] });
    assert.equal(JSON.stringify({ error: error.message, issues: error.issues }).includes('private'), false);
    return true;
  });
});

test('multiline CSV records locate their first physical line without exposing cell contents', async () => {
  const dataset = await parseFiles([csv('users.csv', 'user_id,registered_at\n"private\nplayer",2026-10-01\n\n"private\nplayer",2026-10-02\n')]);
  assert.deepEqual(dataset.inspection.issues.find(issue => issue.code === 'duplicate_users').location.rows, [2, 5]);
  assert.equal(JSON.stringify(dataset.inspection).includes('private'), false);
});

test('Windows CRLF multiline CSV records retain physical start lines with UTF-8 columns', async () => {
  const dataset = await parseFiles([csv('users.csv', '玩家ID,注册日期\r\n"玩家\r\n甲",2026-10-01\r\n\r\n"玩家\r\n甲",2026-10-02\r\n')]);
  assert.deepEqual(dataset.inspection.issues.find(issue => issue.code === 'duplicate_users').location.rows, [2, 5]);
  assert.equal(JSON.stringify(dataset.inspection).includes('玩家\\r'), false);
});

test('conflicting order identifiers containing line breaks are also hidden', async () => {
  await assert.rejects(parseFiles([csv('payments.csv', 'order_id,user_id,paid_at,amount,currency,status\n"order\nprivate",player,2026-10-01,1,CNY,paid\n"order\nprivate",player,2026-10-01,2,CNY,paid\n')]), error => {
    assert.equal(error.message.includes('private'), false);
    assert.equal(error.issues?.[0]?.code, 'conflicting_orders');
    assert.deepEqual(error.issues[0].location.rows, [2, 4]);
    return true;
  });
});

test('unsuccessful payments locate the Chinese source status column and all raw duplicate rows', async () => {
  const dataset = await parseFiles([csv('payments.csv', '订单号,用户ID,支付时间,金额,币种,状态\nprivate-failed,private-player,2026-10-01,1,CNY,FAILED\n\nprivate-failed,private-player,2026-10-01,1,CNY,FAILED\npaid-order,paid-player,2026-10-01,3,CNY, PaiD \nchinese-order,chinese-player,2026-10-01,2,CNY,已支付\n')]);
  const issue = dataset.inspection.issues.find(problem => problem.code === 'unsuccessful_payments');
  assert.deepEqual(issue?.location, { table: 'payments', column: '状态', rows: [2, 4] });
  assert.equal(dataset.inspection.rawRows, 4);
  assert.equal(dataset.inspection.validRows, 3);
  assert.equal(analyze(dataset).metrics.find(metric => metric.id === 'revenue').value, 5);
  assert.equal(JSON.stringify(issue).includes('private'), false);
});
