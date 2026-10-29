const path = require('node:path');

function downloadFilters(filename) {
  const extension = path.extname(typeof filename === 'string' ? filename : '').toLowerCase();
  const types = { '.md': ['Markdown 报告', 'md'], '.csv': ['CSV 表格', 'csv'], '.png': ['PNG 图片', 'png'] };
  const type = types[extension];
  return type ? [{ name: type[0], extensions: [type[1]] }] : [{ name: '所有文件', extensions: ['*'] }];
}
module.exports = { downloadFilters };
