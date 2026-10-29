const test = require('node:test');
const assert = require('node:assert/strict');
const { downloadFilters } = require('./downloads.cjs');
test('报告下载按实际后缀选择保存类型，不把 CSV 或 PNG 标为 Markdown', () => {
  assert.deepEqual(downloadFilters('报告.csv'), [{ name: 'CSV 表格', extensions: ['csv'] }]);
  assert.deepEqual(downloadFilters('趋势.PNG'), [{ name: 'PNG 图片', extensions: ['png'] }]);
  assert.deepEqual(downloadFilters('报告.md'), [{ name: 'Markdown 报告', extensions: ['md'] }]);
  assert.deepEqual(downloadFilters('其他文件'), [{ name: '所有文件', extensions: ['*'] }]);
});
