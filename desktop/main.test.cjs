const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const vm = require('node:vm');
const runtime = require('./runtime.cjs');

// Electron windows cannot run under node:test. Keep the real main process source
// and URL policy, replacing only Electron's native shell and network probe.
function mainHarness({ savedState, displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }], failRead = false, failWrite = false, testUpdater, choices = [], failClipboard = false, failExternal = false } = {}) {
  let persistedState = savedState;
  const windows = [], operations = [], externals = [], exitCodes = [], copied = [], dialogs = []; let menu;
  const failures = new Set();
  const session = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    async clearStorageData({ origin }) { operations.push(['storage', origin]); },
    async clearAuthCache() { operations.push(['auth']); },
    async closeAllConnections() { operations.push(['connections']); },
  });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.url = ''; this.destroyed = false; this.crashed = false;
      this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width, height: options.height }; this.maximized = false;
      this.webContents = Object.assign(new EventEmitter(), {
        session,
        mainFrame: { url: '' },
        setWindowOpenHandler(handler) { this.openHandler = handler; },
        stop: () => operations.push(['stop', this.url]),
        getURL: () => this.url,
        executeJavaScript: async () => {
          if (this.crashed) throw new Error('renderer crashed');
          if (this.url === 'about:blank') throw new Error('连接页表单不存在');
          return true;
        },
      });
      windows.push(this);
    }
    async loadURL(url) {
      operations.push(['load', url]);
      if (failures.has(url)) throw new Error('模拟服务连接失败');
      this.url = url; this.webContents.mainFrame.url = url;
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    show() {} focus() {} isMinimized() { return false; }
    getNormalBounds() { return this.bounds; }
    isMaximized() { return this.maximized; }
    maximize() { this.maximized = true; this.emit('maximize'); }
  }
  const app = Object.assign(new EventEmitter(), {
    setName() {}, setAppUserModelId() {}, setPath() {},
    getPath: () => path.join(__dirname, 'test-user-data'),
    getVersion: () => '1.1.0', requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}), quit() {}, exit: code => exitCodes.push(code),
  });
  const electron = {
    app, BrowserWindow, screen: { getAllDisplays: () => displays }, session: { defaultSession: session },
    Menu: { setApplicationMenu(value) { menu = value; }, buildFromTemplate: value => value, getApplicationMenu() { return null; } },
    clipboard: { writeText(value) { if (failClipboard) throw new Error('private clipboard error'); copied.push(value); } },
    ipcMain: { handle() {} }, dialog: { showErrorBox() {}, showMessageBox: async (...args) => { dialogs.push(args.at(-1)); return { response: choices.shift() }; } },
    shell: { openExternal: async url => { externals.push(url); if (failExternal) throw new Error('private external error'); } },
  };
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : name === './runtime.cjs' ? { ...runtime, probeCloudServer: async value => value } : name === 'node:fs' ? { mkdirSync() {}, appendFileSync() {}, readFileSync() { if (failRead || persistedState === undefined) throw new Error('read failed'); return persistedState; }, writeFileSync(file, value) { if (failWrite) throw new Error('write failed'); if (file.endsWith('window-state.json')) persistedState = value; } } : require(name),
    __dirname, process: { argv: [], env: {}, versions: {} }, console, setTimeout, setImmediate, clearTimeout, testUpdater,
  });
  vm.runInContext(readFileSync(path.join(__dirname, 'main.cjs'), 'utf8'), context, { filename: 'main.cjs' });
  return { windows, operations, externals, failures, exitCodes, copied, dialogs, getMenu: () => menu, getState: () => persistedState, run: expression => vm.runInContext(expression, context) };
}

test('主进程连续检查复用已下载更新，稍后可再次定位文件', async () => {
  let downloaded = false, installs = 0, checks = 0;
  const testUpdater = { ready: () => downloaded ? { version: '1.2.0' } : null, check: async () => { checks++; return { version: '1.2.0' }; }, download: async () => { downloaded = true; }, reveal: async () => { installs++; } };
  const h = mainHarness({ testUpdater, choices: [0, 1, 0] });
  h.run('updater = testUpdater');
  await h.run('checkForUpdates()');
  assert.equal(installs, 0);
  await h.run('checkForUpdates()');
  assert.equal(checks, 1); assert.equal(installs, 1);
});

test('连接页连续切换服务器不会导航至空页，旧服务仅清理一次', async () => {
  const h = mainHarness();
  await h.run("connectToServer('https://old.example')");
  await h.run('switchServer()');
  const connection = h.run('connectionWindow');
  const originalUrl = connection.url;
  await h.run('switchServer()');
  assert.equal(connection.url, originalUrl);
  assert.equal(connection.destroyed, false);
  assert.equal(h.operations.filter(([type]) => type === 'storage').length, 1);
  assert.deepEqual(h.exitCodes, []);
});

test('服务失败回连接页后改地址会先清理旧origin会话再加载新服务', async () => {
  const h = mainHarness();
  await h.run("connectToServer('https://old.example')");
  h.operations.length = 0;
  await h.run("showConnection({error:'服务连接失败'})");
  await h.run("connectToServer('https://new.example')");
  const cleared = h.operations.findIndex(([type, origin]) => type === 'storage' && origin === 'https://old.example');
  const connected = h.operations.findIndex(([type, url]) => type === 'load' && url === 'https://new.example');
  assert.ok(cleared >= 0, '必须清理旧origin');
  assert.ok(cleared < connected, '必须在加载新服务前清理');
  assert.equal(h.operations.some(([type]) => type === 'auth'), true);
  assert.equal(h.operations.some(([type]) => type === 'connections'), true);
});

test('重新连接同一服务也通过相同会话清理路径', async () => {
  const h = mainHarness();
  await h.run("connectToServer('https://old.example')");
  h.operations.length = 0;
  await h.run("showConnection({error:'连接中断'})");
  await h.run("connectToServer('https://old.example')");
  assert.deepEqual(h.operations.find(([type]) => type === 'storage'), ['storage', 'https://old.example']);
});

test('远程页面加载失败会清理会话并回到可重试的连接页', async () => {
  const h = mainHarness();
  await h.run("connectToServer('https://old.example')");
  const failed = h.run('window');
  h.operations.length = 0;
  failed.webContents.emit('did-fail-load', {}, -102, 'connection refused', 'https://old.example', true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.operations.find(([type]) => type === 'storage'), ['storage', 'https://old.example']);
  assert.equal(failed.destroyed, true);
  assert.match(h.run('window').url, /connection\.html$/);
});

test('主框架外链由安全导航处理，子框架禁止离开云端origin', async () => {
  const h = mainHarness();
  await h.run("connectToServer('https://old.example')");
  const remote = h.run('window');
  let prevented = false;
  const mainEvent = { url: 'https://docs.example/help', isMainFrame: true, preventDefault() { prevented = true; } };
  remote.webContents.emit('will-frame-navigate', mainEvent);
  assert.equal(prevented, false, '主框架必须留给 will-navigate 处理');
  remote.webContents.emit('will-navigate', mainEvent, mainEvent.url);
  assert.equal(prevented, true);
  assert.deepEqual(h.externals, ['https://docs.example/help']);
  const childEvent = { url: 'https://docs.example/help', isMainFrame: false, preventDefault() { this.prevented = true; } };
  remote.webContents.emit('will-frame-navigate', childEvent);
  assert.equal(childEvent.prevented, true);
  const sameOrigin = { url: 'https://old.example/view', isMainFrame: false, preventDefault() { this.prevented = true; } };
  remote.webContents.emit('will-frame-navigate', sameOrigin);
  assert.equal(sameOrigin.prevented, undefined);
});

test('本地连接页renderer崩溃后重建可操作窗口并关闭旧窗口', async () => {
  const h = mainHarness();
  await h.run('showConnection()');
  const crashed = h.run('connectionWindow');
  crashed.crashed = true;
  crashed.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  await new Promise(resolve => setImmediate(resolve));
  const recovered = h.run('connectionWindow');
  assert.notEqual(recovered, crashed, '不能复用已崩溃renderer');
  assert.equal(recovered.destroyed, false);
  assert.equal(crashed.destroyed, true);
  assert.match(recovered.url, /connection\.html$/);
  assert.deepEqual(h.exitCodes, []);
});


test('工作台关闭时保存正常边界与最大化状态，重启后恢复', async () => {
  const h = mainHarness();
  await h.run("connectToServer('https://old.example')");
  const remote = h.run('window');
  remote.bounds = { x: 120, y: 80, width: 1200, height: 800 };
  remote.emit('resize');
  remote.maximize();
  remote.bounds = { x: -32000, y: -32000, width: 1, height: 1 };
  remote.emit('close');
  const saved = JSON.parse(h.getState());
  assert.deepEqual(saved, { bounds: { x: 120, y: 80, width: 1200, height: 800 }, maximized: true });
  const restarted = mainHarness({ savedState: h.getState() });
  await restarted.run("connectToServer('https://old.example')");
  const restored = restarted.run('window');
  assert.deepEqual({ ...restored.bounds }, saved.bounds);
  assert.equal(restored.isMaximized(), true);
});

test('负坐标显示器可恢复，拔除后离屏边界移回可见区域', async () => {
  const savedState = JSON.stringify({ bounds: { x: -1500, y: 100, width: 1200, height: 800 }, maximized: false });
  const displays = [{ workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }, { workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  const h = mainHarness({ savedState, displays });
  await h.run("connectToServer('https://old.example')");
  assert.equal(h.run('window').bounds.x, -1500);
  const removed = mainHarness({ savedState, displays: [displays[1]] });
  await removed.run("connectToServer('https://old.example')");
  const b = removed.run('window').bounds;
  assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1920 && b.y + b.height <= 1080);
});

test('损坏、极小状态及读写失败不会阻止工作台或连接页打开', async () => {
  for (const options of [{ savedState: '{bad' }, { savedState: JSON.stringify({ bounds: { x: 0, y: 0, width: 2, height: 2 }, maximized: true }) }, { failRead: true, failWrite: true }]) {
    const h = mainHarness(options);
    await h.run('showConnection()');
    assert.equal(h.run('window').options.width, 760);
    await h.run("connectToServer('https://old.example')");
    const remote = h.run('window');
    assert.equal(remote.options.width, 1500);
    assert.equal(remote.isMaximized(), false);
    assert.doesNotThrow(() => remote.emit('close'));
  }
});

test('首次打开后直接最大化仍保存原始正常边界', async () => {
  const h = mainHarness();
  await h.run("connectToServer('https://old.example')");
  const remote = h.run('window');
  remote.maximize();
  assert.deepEqual(JSON.parse(h.getState()), { bounds: { x: 0, y: 0, width: 1500, height: 960 }, maximized: true });
});

test('小屏裁剪后的窗口和最大化状态在连续重启后仍可恢复', async () => {
  const displays = [{ workArea: { x: 20, y: 30, width: 800, height: 600 } }];
  const savedState = JSON.stringify({ bounds: { x: 100, y: 100, width: 1200, height: 800 }, maximized: true });
  const first = mainHarness({ savedState, displays });
  await first.run("connectToServer('https://old.example')");
  const firstWindow = first.run('window');
  assert.deepEqual({ ...firstWindow.bounds }, { x: 20, y: 30, width: 800, height: 600 });
  assert.equal(firstWindow.isMaximized(), true);
  firstWindow.emit('close');
  const second = mainHarness({ savedState: first.getState(), displays });
  await second.run("connectToServer('https://old.example')");
  const secondWindow = second.run('window');
  assert.deepEqual({ ...secondWindow.bounds }, { x: 20, y: 30, width: 800, height: 600 });
  assert.equal(secondWindow.isMaximized(), true);
});

test('桌面托盘接收当前主框架摘要，关闭窗口隐藏且切换服务清空', async () => {
  const h = mainHarness();
  await h.run("connectToServer('https://old.example')");
  const remote = h.run('window');
  assert.match(remote.options.webPreferences.preload, /desktop-preload\.cjs$/);
  h.run('startTray()');
  assert.equal(h.run('trayController.shouldHide()'), false);
  const event = { sender: remote.webContents, senderFrame: remote.webContents.mainFrame };
  assert.equal(h.run('handleTraySummary')(event, [{ id: '1', title: '测试', status: 'running' }]), true);
  assert.equal(h.run('handleTraySummary')({ ...event, senderFrame: { url: remote.url } }, []), false);
  await h.run('switchServer()');
  assert.equal(h.run('handleTraySummary')(event, []), false);
});

test('主框架同文档导航保留托盘状态，跨文档导航清除', async () => {
  const h = mainHarness(); await h.run("connectToServer('https://old.example')");
  h.run('trayController = { clear() { globalThis.clears = (globalThis.clears || 0) + 1; } }');
  const contents = h.run('window').webContents;
  contents.emit('did-start-navigation', {}, 'https://old.example/#part', true, true);
  assert.equal(h.run('globalThis.clears || 0'), 0);
  contents.emit('did-start-navigation', {}, 'https://old.example/next', false, true);
  assert.equal(h.run('globalThis.clears'), 1);
});

test('托盘就绪状态只接受可信主框架的有限值', async () => {
  const h = mainHarness(); await h.run("connectToServer('https://old.example')");
  h.run('trayController = { setState(value) { globalThis.lastTrayState = value; } }');
  const contents = h.run('window').webContents; const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(h.run('handleTrayState')(event, 'ready'), true);
  assert.equal(h.run('handleTrayState')({ ...event, senderFrame: { url: contents.mainFrame.url } }, 'login'), false);
  assert.equal(h.run('handleTrayState')(event, 'quit'), false);
  assert.equal(h.run('globalThis.lastTrayState'), 'ready');
});

test('帮助菜单复制当前连接诊断，断开后显示未连接', async () => {
  const h = mainHarness();
  h.run('installMenu()');
  const item = h.getMenu().find(entry => entry.label === '帮助').submenu.find(entry => entry.label === '复制诊断信息');
  assert.ok(item);
  await h.run("connectToServer('https://old.example')");
  item.click();
  assert.equal(JSON.parse(h.copied[0]).serverOrigin, 'https://old.example');
  await h.run('switchServer()');
  item.click();
  assert.equal(JSON.parse(h.copied[1]).serverOrigin, '未连接');
});
test('复制诊断失败时显示中文失败提示，不暴露异常', () => {
  const h = mainHarness({ failClipboard: true }); h.run('installMenu()');
  const item = h.getMenu().find(entry => entry.label === '帮助').submenu.find(entry => entry.label === '复制诊断信息');
  assert.doesNotThrow(() => item.click());
  assert.match(JSON.stringify(h.dialogs), /复制.*失败/);
  assert.doesNotMatch(JSON.stringify(h.dialogs), /private clipboard error|已复制到剪贴板/);
});

test('断开连接时帮助菜单仍可打开固定反馈地址', async () => {
  const h = mainHarness(); h.run('installMenu()'); await h.run('showConnection()');
  const item = h.getMenu().find(entry => entry.label === '帮助').submenu.find(entry => entry.label === '问题反馈…');
  assert.ok(item); await item.click();
  assert.deepEqual(h.externals, ['https://github.com/lu-13-debug/DataAgent/issues']);
});

test('反馈地址打开失败时提供固定地址和联网提示，不暴露异常', async () => {
  const h = mainHarness({ failExternal: true }); h.run('installMenu()');
  const item = h.getMenu().find(entry => entry.label === '帮助').submenu.find(entry => entry.label === '问题反馈…');
  assert.ok(item); await item.click();
  assert.match(JSON.stringify(h.dialogs), /联网/);
  assert.match(JSON.stringify(h.dialogs), /https:\/\/github\.com\/lu-13-debug\/DataAgent\/issues/);
  assert.doesNotMatch(JSON.stringify(h.dialogs), /private external error/);
});