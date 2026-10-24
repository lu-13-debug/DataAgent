const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const vm = require('node:vm');
const runtime = require('./runtime.cjs');

// Electron windows cannot run under node:test. Keep the real main process source
// and URL policy, replacing only Electron's native shell and network probe.
function mainHarness() {
  const windows = [], operations = [], externals = [], exitCodes = [];
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
  }
  const app = Object.assign(new EventEmitter(), {
    setName() {}, setAppUserModelId() {}, setPath() {},
    getPath: () => path.join(__dirname, 'test-user-data'),
    getVersion: () => '1.1.0', requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}), quit() {}, exit: code => exitCodes.push(code),
  });
  const electron = {
    app, BrowserWindow, session: { defaultSession: session },
    Menu: { setApplicationMenu() {}, buildFromTemplate: value => value },
    ipcMain: { handle() {} }, dialog: { showErrorBox() {} },
    shell: { openExternal: async url => externals.push(url) },
  };
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : name === './runtime.cjs' ? { ...runtime, probeCloudServer: async value => value } : name === 'node:fs' ? { mkdirSync() {}, appendFileSync() {}, writeFileSync() {} } : require(name),
    __dirname, process: { argv: [], env: {}, versions: {} }, console, setTimeout, setImmediate, clearTimeout,
  });
  vm.runInContext(readFileSync(path.join(__dirname, 'main.cjs'), 'utf8'), context, { filename: 'main.cjs' });
  return { windows, operations, externals, failures, exitCodes, run: expression => vm.runInContext(expression, context) };
}

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
