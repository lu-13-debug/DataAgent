const { app, BrowserWindow, Menu, dialog, shell, ipcMain, session } = require('electron');
const path = require('node:path');
const { mkdirSync, appendFileSync, writeFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const { desktopPaths, allowedNavigation, safeExternalUrl, loadServerUrl, isConnectionSender, probeCloudServer, saveCloudConnection } = require('./runtime.cjs');

app.setName('DataAgent');
app.setAppUserModelId('com.dataagent.desktop');
const smoke = process.argv.includes('--smoke-test');
const customData = process.argv.find(arg => arg.startsWith('--dataagent-user-data='));
if (customData) app.setPath('userData', path.resolve(customData.slice('--dataagent-user-data='.length)));
const paths = desktopPaths(app.getPath('userData'));
const connectionFile = path.join(app.getPath('userData'), 'connection.json');
const connectionUrl = pathToFileURL(path.join(__dirname, 'connection.html')).href;
mkdirSync(paths.logs, { recursive: true });
const log = message => appendFileSync(path.join(paths.logs, 'desktop.log'), `${new Date().toISOString()} ${message}\n`);
let window, connectionWindow, cloudOrigin, lastServerUrl = '', clearingSession, switching = false, quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(start).catch(fail);
}

async function start() {
  log(`启动云端客户端 ${app.getVersion()} / Electron ${process.versions.electron}`);
  ipcMain.handle('dataagent:connect', async (event, value) => {
    if (!isConnectionSender(event, connectionWindow?.webContents, connectionUrl)) throw new Error('连接请求来源无效。');
    if (switching) return { ok: false, error: '正在连接，请稍候。' };
    switching = true;
    try {
      const target = await saveCloudConnection(connectionFile, value);
      setImmediate(() => connectToServer(target).catch(fail).finally(() => { switching = false; }));
      return { ok: true };
    } catch (error) { switching = false; return { ok: false, error: friendlyError(error) }; }
  });
  installMenu();
  try {
    const target = await loadServerUrl({ environmentUrl: process.env.DATAAGENT_SERVER_URL, connectionFile, bundledFile: path.join(__dirname, '..', 'build', 'cloud-config.json') });
    if (target) await connectToServer(target);
    else await showConnection();
  } catch (error) { if (smoke) throw error; await showConnection({ error: friendlyError(error) }); }
}
function makeWindow(local) {
  const win = new BrowserWindow({
    title: local ? '连接 DataAgent 服务' : 'DataAgent · 游戏数据分析',
    width: local ? 760 : 1500, height: local ? 760 : 960, minWidth: local ? 520 : 1000, minHeight: local ? 620 : 700,
    backgroundColor: '#f6f8fb', show: false, autoHideMenuBar: true, icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false, ...(local ? { preload: path.join(__dirname, 'connection-preload.cjs') } : {}) },
  });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.setWindowOpenHandler(({ url }) => { const safe = safeExternalUrl(url); if (safe) void shell.openExternal(safe); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (local ? url !== connectionUrl : !allowedNavigation(url, cloudOrigin)) { event.preventDefault(); const safe = safeExternalUrl(url); if (safe) void shell.openExternal(safe); }
  });
  win.webContents.on('will-redirect', (event, url) => { if (local || !allowedNavigation(url, cloudOrigin)) event.preventDefault(); });
  win.webContents.on('will-frame-navigate', event => { if (!event.isMainFrame && (local ? event.url !== connectionUrl : !allowedNavigation(event.url, cloudOrigin))) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('render-process-gone', (_event, details) => {
    log(`界面进程退出：${details.reason}`);
    if (local && connectionWindow === win) connectionWindow = null;
    if (!quitting) void showConnection({ serverUrl: lastServerUrl, error: '界面意外退出，请重新连接服务。' }).catch(fail);
  });
  return win;
}
async function showConnection({ serverUrl = lastServerUrl, error = '' } = {}) {
  if (quitting) return;
  await clearCloudSession();
  if (!connectionWindow || connectionWindow.isDestroyed()) {
    connectionWindow = makeWindow(true);
    const local = connectionWindow;
    local.on('closed', () => { if (connectionWindow === local) connectionWindow = null; });
    await local.loadURL(connectionUrl);
  }
  const local = connectionWindow;
  if (local.webContents.getURL() !== connectionUrl) await local.loadURL(connectionUrl);
  await local.webContents.executeJavaScript(`document.getElementById('server-url').value = ${JSON.stringify(serverUrl)}; document.getElementById('status').textContent = ${JSON.stringify(error)}; document.getElementById('status').dataset.ok = 'false';`);
  const previous = window; window = local;
  local.show(); local.focus();
  if (previous && previous !== local && !previous.isDestroyed()) previous.destroy();
}
async function connectToServer(target) {
  lastServerUrl = target;
  await clearCloudSession();
  try { await probeCloudServer(target); }
  catch (error) { if (smoke) throw error; await showConnection({ serverUrl: target, error: friendlyError(error) }); return; }
  cloudOrigin = target;
  const remote = makeWindow(false);
  let loaded = false;
  remote.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (loaded && mainFrame && code !== -3 && !quitting) void showConnection({ serverUrl: target, error: '服务暂时无法访问，请重试或更换地址。' }).catch(fail);
  });
  try { await remote.loadURL(target); }
  catch (error) { if (smoke) { remote.destroy(); throw error; } await showConnection({ serverUrl: target, error: friendlyError(error) }); remote.destroy(); return; }
  loaded = true;
  const previous = window; window = remote;
  if (!smoke) remote.show();
  if (previous && previous !== remote && !previous.isDestroyed()) previous.destroy();
  log('已连接云端账号工作台。');
  if (smoke) await smokeTest(remote, target);
}
async function switchServer() {
  if (switching) return;
  switching = true;
  try {
    await showConnection();
  } catch (error) { await showConnection({ error: friendlyError(error) }); }
  finally { switching = false; }
}
async function clearCloudSession() {
  if (clearingSession) return clearingSession;
  if (!cloudOrigin) return;
  const previousOrigin = cloudOrigin;
  clearingSession = (async () => {
    if (window && window !== connectionWindow && !window.isDestroyed()) {
      window.webContents.stop();
      try { await window.loadURL('about:blank'); }
      catch (error) { log(`停止旧服务页面：${error.message}`); }
    }
    await session.defaultSession.clearStorageData({ origin: previousOrigin });
    await session.defaultSession.clearAuthCache();
    await session.defaultSession.closeAllConnections();
    cloudOrigin = null;
    log('已清理原服务的本机会话。');
  })();
  try { await clearingSession; }
  finally { clearingSession = null; }
}
function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '切换服务器…', click: () => void switchServer().catch(fail) }, { type: 'separator' }, { label: '退出 DataAgent', role: 'quit' }] },
    { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' }, { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }] },
    { label: '视图', submenu: [{ label: '重新载入', role: 'reload' }, { label: '实际大小', role: 'resetZoom' }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { label: '全屏', role: 'togglefullscreen' }] },
    { label: '帮助', submenu: [{ label: '打开日志目录', click: () => void shell.openPath(paths.logs) }, { label: '关于 DataAgent', click: () => void dialog.showMessageBox(window, { type: 'info', title: '关于 DataAgent', message: 'DataAgent', detail: `版本 ${app.getVersion()}\n游戏运营 AI 数据分析工作台\n云端账号客户端 · 数据保存在所连接的服务` }) }] },
  ]));
  session.defaultSession.on('will-download', (_event, item) => { item.setSaveDialogOptions({ title: '保存分析报告', defaultPath: path.join(app.getPath('downloads'), item.getFilename()), filters: [{ name: 'Markdown 报告', extensions: ['md'] }] }); });
}
async function smokeTest(remote, origin) {
  const deadline = Date.now() + 25000;
  let loginPage = false;
  while (Date.now() < deadline) {
    loginPage = await remote.webContents.executeJavaScript("Boolean(document.querySelector('input[type=password]'))");
    if (loginPage) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const nodeIsolated = await remote.webContents.executeJavaScript("typeof window.require === 'undefined' && typeof window.process === 'undefined' && typeof window.dataagentConnection === 'undefined'");
  const anonymousStatus = await remote.webContents.executeJavaScript("fetch('/api/bootstrap').then(response => response.status)");
  if (!loginPage || !nodeIsolated || anonymousStatus !== 401) throw new Error('打包验收失败：账号登录页、未登录保护或远程页面隔离异常。');
  const result = { ok: true, mode: 'cloud', appVersion: app.getVersion(), electron: process.versions.electron, node: process.versions.node, serverUrl: origin, loginPage, nodeIsolated, anonymousStatus, packaged: app.isPackaged };
  writeFileSync(path.join(app.getPath('userData'), 'desktop-smoke-result.json'), JSON.stringify(result, null, 2));
  log('云端桌面启动验收通过。'); app.quit();
}
function friendlyError(error) {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return '服务连接超时，请检查地址和网络后重试。';
  if (error.message === 'fetch failed' || error.code?.startsWith('ERR_')) return '无法连接该服务，请检查地址、HTTPS 证书和网络后重试。';
  return error.message || '连接失败，请检查地址并重试。';
}
function fail(error) {
  log(`连接失败：${error?.stack || error}`);
  if (smoke) { writeFileSync(path.join(app.getPath('userData'), 'desktop-smoke-result.json'), JSON.stringify({ ok: false, error: friendlyError(error) })); app.exit(1); }
  else void showConnection({ error: friendlyError(error) }).catch(fatal => { log(`连接页面无法打开：${fatal.stack || fatal}`); dialog.showErrorBox('DataAgent 无法打开', `请检查安装文件并查看日志：\n${paths.logs}`); app.exit(1); });
}
