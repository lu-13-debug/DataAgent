const test = require('node:test');
const assert = require('node:assert/strict');
const { trustedSender, validateSummaries, createTrayController } = require('./tray.cjs');

test('仅当前服务主框架可更新托盘', () => {
  const mainFrame = { url: 'https://example.com/work' }; const contents = { mainFrame };
  assert.equal(trustedSender({ sender: contents, senderFrame: mainFrame }, contents, 'https://example.com'), true);
  assert.equal(trustedSender({ sender: contents, senderFrame: { url: mainFrame.url } }, contents, 'https://example.com'), false);
  assert.equal(trustedSender({ sender: contents, senderFrame: mainFrame }, contents, null), false);
  mainFrame.url = 'https://other.example/';
  assert.equal(trustedSender({ sender: contents, senderFrame: mainFrame }, contents, 'https://example.com'), false);
});

test('只接受有限数量和字段的运行或待确认摘要', () => {
  assert.deepEqual(validateSummaries([{ id: '1', title: '分析', status: 'running' }]), [{ id: '1', title: '分析', status: 'running' }]);
  for (const invalid of [[{ id: '1', title: 'x', status: 'completed' }], [{ id: '1', title: 'x', status: 'running', key: 'secret' }], [{ id: 'x'.repeat(129), title: 'x', status: 'running' }], Array(21).fill({ id: '1', title: 'x', status: 'running' })]) assert.equal(validateSummaries(invalid), null);
});

test('托盘只提供展示、新建向导、退出和关闭方式，失败安全降级', () => {
  let menu, clicked = '', saved; const tray = { setToolTip() {}, setContextMenu(value) { menu = value; }, on() {}, destroy() {} };
  const controller = createTrayController({ create: () => tray, buildMenu: value => value, show: () => { clicked = 'show'; }, newAnalysis: () => { clicked = 'new'; }, quit: () => { clicked = 'quit'; }, save: value => { saved = value; }, initialCloseToTray: false });
  assert.equal(controller.start(), true); controller.setState('ready'); controller.update([{ id: '1', title: '测试', status: 'awaiting_approval' }]);
  assert.ok(menu.some(item => item.label?.includes('测试') && item.label.includes('待确认')));
  menu.find(item => item.label === '新建分析').click(); assert.equal(clicked, 'new');
  menu.find(item => item.label === '关闭窗口时最小化到托盘').click({ checked: true }); assert.equal(saved, true); assert.equal(controller.shouldHide(), true);
  const failed = createTrayController({ create: () => { throw Error('no tray'); }, buildMenu: value => value, initialCloseToTray: true });
  assert.equal(failed.start(), false); assert.equal(failed.shouldHide(), false);
});


test('托盘关闭设置保存后重启恢复，托盘不可用时不隐藏窗口', () => {
  let settings = '{}'; let menu; const makeTray = () => ({ on() {}, setToolTip() {}, setContextMenu(value) { menu = value; }, destroy() {} });
  const make = () => createTrayController({ create: makeTray, buildMenu: value => value, save: value => { settings = JSON.stringify({ closeToTray: value }); }, initialCloseToTray: JSON.parse(settings).closeToTray === true });
  let controller = make(); controller.start();
  menu.find(item => item.label === '关闭窗口时最小化到托盘').click({ checked: true });
  controller.destroy(); controller = make(); controller.start(); assert.equal(controller.shouldHide(), true);
  const unavailable = createTrayController({ create: () => { throw Error('unavailable'); }, buildMenu: value => value, initialCloseToTray: true });
  unavailable.start(); assert.equal(unavailable.shouldHide(), false);
});

test('托盘菜单更新失败时恢复可能隐藏的窗口', () => {
  let calls = 0, restored = 0; const tray = { on() {}, setToolTip() {}, setContextMenu() { if (++calls > 2) throw Error('tray unavailable'); }, destroy() {} };
  const controller = createTrayController({ create: () => tray, buildMenu: x => x, show: () => { restored++; }, initialCloseToTray: true });
  assert.equal(controller.start(), true); assert.equal(controller.shouldHide(), true);
  controller.setState('ready'); controller.update([]); assert.equal(controller.shouldHide(), false); assert.equal(restored, 1);
});

test('旧版服务和登录页有明确状态且无法新建，工作台就绪后才启用', () => {
  let menu; const controller = createTrayController({ create: () => ({ on() {}, setToolTip() {}, setContextMenu(value) { menu = value; }, destroy() {} }), buildMenu: x => x });
  controller.start();
  assert.ok(menu.some(item => item.label === '当前服务版本不支持托盘任务，请更新服务'));
  assert.equal(menu.find(item => item.label === '新建分析').enabled, false);
  controller.setState('login'); assert.ok(menu.some(item => item.label === '请先登录工作台')); assert.equal(menu.find(item => item.label === '新建分析').enabled, false);
  controller.setState('ready'); assert.equal(menu.find(item => item.label === '新建分析').enabled, true);
  controller.clear(); assert.ok(menu.some(item => item.label === '当前服务版本不支持托盘任务，请更新服务')); assert.equal(menu.find(item => item.label === '新建分析').enabled, false);
});

test('未就绪时不能缓存任务摘要或通过旧菜单触发新建', () => {
  let menu, created = 0; const controller = createTrayController({ create: () => ({ on() {}, setToolTip() {}, setContextMenu(value) { menu = value; }, destroy() {} }), buildMenu: x => x, newAnalysis: () => created++ });
  controller.start(); const staleNew = menu.find(item => item.label === '新建分析');
  controller.update([{ id: 'x', title: '旧账号任务', status: 'running' }]);
  controller.setState('ready');
  assert.equal(menu.some(item => item.label?.includes('旧账号任务')), false);
  controller.setState('login'); staleNew.click(); assert.equal(created, 0);
});
