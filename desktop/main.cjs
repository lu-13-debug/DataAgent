const { app, BrowserWindow, Menu, dialog, shell, ipcMain, session, screen, Tray, clipboard, nativeTheme } = require('electron');
const path = require('node:path');
const { trustedSender, validateSummaries, createTrayController } = require('./tray.cjs');
const { createNotificationPolicy } = require('./permissions.cjs');
const { createAppearancePolicy } = require('./appearance.cjs');
const { downloadFilters } = require('./downloads.cjs');
const { createUpdater } = require('./updater.cjs');
const { runUpdate } = require('./update-ui.cjs');
const { mkdirSync, appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const { desktopPaths, allowedNavigation, safeExternalUrl, buildSupportDiagnostic, loadServerUrl, isConnectionSender, probeCloudServer, saveCloudConnection } = require('./runtime.cjs');

app.setName('DataAgent');
app.setAppUserModelId('com.dataagent.desktop');
const smoke = process.argv.includes('--smoke-test');
const customData = process.argv.find(arg => arg.startsWith('--dataagent-user-data='));
if (customData) app.setPath('userData', path.resolve(customData.slice('--dataagent-user-data='.length)));
const paths = desktopPaths(app.getPath('userData'));
const connectionFile = path.join(app.getPath('userData'), 'connection.json');
const traySettingsFile = path.join(app.getPath('userData'), 'desktop-settings.json');
const windowStateFile = path.join(app.getPath('userData'), 'window-state.json');
const connectionUrl = pathToFileURL(path.join(__dirname, 'connection.html')).href;
mkdirSync(paths.logs, { recursive: true });
const log = message => appendFileSync(path.join(paths.logs, 'desktop.log'), `${new Date().toISOString()} ${message}\n`);
let trayController;
let updater;
let window, connectionWindow, appearanceWindow, cloudOrigin, lastServerUrl = '', clearingSession, switching = false, quitting = false, updating = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitting = true; trayController?.destroy(); });
  app.whenReady().then(start).catch(fail);
}

async function start() {
  log(`启动云端客户端 ${app.getVersion()} / Electron ${process.versions.electron}`);
  updater = makeUpdater();
  try { await updater.initialize(); } catch (error) { log(`清理旧更新文件失败：${error.message}`); }
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
  ipcMain.handle('dataagent:tray-summary', handleTraySummary);
  ipcMain.handle('dataagent:tray-state', handleTrayState);
  ipcMain.handle('dataagent:show-window', event => { if (!trustedSender(event, window?.webContents, cloudOrigin)) return false; showMainWindow(); return true; });
  const appearance = createAppearancePolicy({ nativeTheme, getWindow: () => appearanceWindow || window, getOrigin: () => cloudOrigin });
  ipcMain.on('appearance:set-theme', (event, theme) => appearance.set(event, theme));
  nativeTheme.on('updated', appearance.update);
  startTray();
  installMenu();
  try {
    const target = await loadServerUrl({ environmentUrl: process.env.DATAAGENT_SERVER_URL, connectionFile, bundledFile: path.join(__dirname, '..', 'build', 'cloud-config.json') });
    if (target) await connectToServer(target);
    else await showConnection();
  } catch (error) { if (smoke) throw error; await showConnection({ error: friendlyError(error) }); }
}
function showMainWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}
function handleTraySummary(event, value) {
  if (!trustedSender(event, window?.webContents, cloudOrigin)) return false;
  const summaries = validateSummaries(value);
  if (!summaries) return false;
  trayController?.update(summaries);
  return true;
}
function handleTrayState(event, state) {
  if (!trustedSender(event, window?.webContents, cloudOrigin) || !['login', 'ready'].includes(state)) return false;
  trayController?.setState(state);
  return true;
}
function startTray() {
  let closeToTray = false;
  try { closeToTray = JSON.parse(readFileSync(traySettingsFile, 'utf8'))?.closeToTray === true; } catch {}
  trayController = createTrayController({
    create: () => new Tray(path.join(__dirname, '..', 'build', 'tray.png')),
    buildMenu: value => Menu.buildFromTemplate(value), show: showMainWindow,
    newAnalysis: () => {
      showMainWindow();
      const contents = window?.webContents;
      if (contents && trustedSender({ sender: contents, senderFrame: contents.mainFrame }, contents, cloudOrigin)) contents.send('dataagent:tray-new');
    },
    quit: () => app.quit(),
    save: value => writeFileSync(traySettingsFile, JSON.stringify({ closeToTray: value }), 'utf8'),
    initialCloseToTray: closeToTray,
  });
  if (!trayController.start()) log('系统托盘不可用，关闭窗口将退出。');
}
function validWindowBounds(bounds) {
  return bounds && ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(bounds[key])) && bounds.width >= 320 && bounds.height >= 240;
}
function restoreWindowState() {
  try {
    const state = JSON.parse(readFileSync(windowStateFile, 'utf8'));
    if (!validWindowBounds(state?.bounds) || typeof state.maximized !== 'boolean') return null;
    const areas = screen.getAllDisplays().map(display => display.workArea).filter(area => area && area.width > 0 && area.height > 0);
    if (!areas.length) return null;
    const b = state.bounds;
    const overlap = area => Math.max(0, Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x)) * Math.max(0, Math.min(b.y + b.height, area.y + area.height) - Math.max(b.y, area.y));
    const area = areas.reduce((best, candidate) => overlap(candidate) > overlap(best) ? candidate : best);
    const width = Math.min(b.width, area.width), height = Math.min(b.height, area.height);
    return { bounds: { x: Math.max(area.x, Math.min(b.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(b.y, area.y + area.height - height)), width, height }, maximized: state.maximized };
  } catch { return null; }
}
function trackWindowState(win, restored) {
  let normalBounds = restored?.bounds || null;
  try { if (!normalBounds && validWindowBounds(win.getNormalBounds())) normalBounds = win.getNormalBounds(); } catch {}
  const save = () => {
    try {
      if (!win.isMaximized() && !win.isMinimized() && !(win.isFullScreen?.())) {
        const bounds = win.getNormalBounds();
        if (validWindowBounds(bounds)) normalBounds = bounds;
      }
      if (normalBounds) writeFileSync(windowStateFile, JSON.stringify({ bounds: normalBounds, maximized: win.isMaximized() }), 'utf8');
    } catch { /* Window state is optional; never interrupt the application. */ }
  };
  for (const event of ['move', 'resize', 'maximize', 'unmaximize', 'close']) win.on(event, save);
}
function makeWindow(local) {
  const state = local ? null : restoreWindowState();
  const win = new BrowserWindow({
    title: local ? '连接 DataAgent 服务' : 'DataAgent · 游戏数据分析',
    width: local ? 760 : 1500, height: local ? 760 : 960, minWidth: local ? 520 : 1000, minHeight: local ? 620 : 700,
    ...(state ? { ...state.bounds, minWidth: Math.min(1000, state.bounds.width), minHeight: Math.min(700, state.bounds.height) } : {}),
    backgroundColor: local ? '#f6f8fb' : '#0d1110', show: false, autoHideMenuBar: true, icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false, preload: path.join(__dirname, local ? 'connection-preload.cjs' : 'desktop-preload.cjs') },
  });
  if (!local) {
    trackWindowState(win, state);
    win.on('close', event => { if (!quitting && window === win && trayController?.shouldHide()) { event.preventDefault(); win.hide(); } });
    win.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace && window === win) trayController?.clear(); });
    if (state?.maximized) win.maximize();
  }
  const notificationPolicy = createNotificationPolicy({
    getOrigin: () => local ? null : cloudOrigin,
    getContents: () => win.webContents,
    confirm: async () => (await dialog.showMessageBox(win, { type: 'question', buttons: ['允许任务通知', '暂不开启'], defaultId: 1, cancelId: 1, title: '任务完成通知', message: '允许 DataAgent 发送任务完成或失败通知？', detail: '只对当前连接的服务生效，其他设备权限继续保持关闭。' })).response === 0,
  });
  win.webContents.session.setPermissionRequestHandler(notificationPolicy.request);
  win.webContents.session.setPermissionCheckHandler(notificationPolicy.check);
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
  appearanceWindow = remote;
  let loaded = false;
  remote.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (loaded && mainFrame && code !== -3 && !quitting) void showConnection({ serverUrl: target, error: '服务暂时无法访问，请重试或更换地址。' }).catch(fail);
  });
  try { await remote.loadURL(target); }
  catch (error) { appearanceWindow = null; if (smoke) { remote.destroy(); throw error; } await showConnection({ serverUrl: target, error: friendlyError(error) }); remote.destroy(); return; }
  loaded = true;
  const previous = window; window = remote;
  appearanceWindow = null;
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
  trayController?.clear();
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
    { label: '帮助', submenu: [{ id: 'check-updates', label: '检查更新…', click: () => void checkForUpdates() }, { label: '问题反馈…', click: openFeedback }, { label: '复制诊断信息', click: copySupportDiagnostic }, { label: '打开日志目录', click: () => void shell.openPath(paths.logs) }, { label: '关于 DataAgent', click: () => void dialog.showMessageBox(window, { type: 'info', title: '关于 DataAgent', message: 'DataAgent', detail: `版本 ${app.getVersion()}\n游戏运营 AI 数据分析工作台\n云端账号客户端 · 数据保存在所连接的服务` }) }] },
  ]));
  session.defaultSession.on('will-download', (_event, item) => { item.setSaveDialogOptions({ title: '保存分析报告', defaultPath: path.join(app.getPath('downloads'), item.getFilename()), filters: downloadFilters(item.getFilename()) }); });
}
const feedbackUrl = 'https://github.com/lu-13-debug/DataAgent/issues';
async function openFeedback() {
  try { await shell.openExternal(feedbackUrl); }
  catch { await dialog.showMessageBox({ type: 'error', title: '无法打开反馈页面', message: '无法打开反馈页面', detail: `请联网后在浏览器中访问以下地址，可复制地址使用：\n${feedbackUrl}` }); }
}
function copySupportDiagnostic() {
  try { clipboard.writeText(buildSupportDiagnostic({ version: app.getVersion(), origin: cloudOrigin, logs: paths.logs })); }
  catch { void dialog.showMessageBox({ type: 'error', title: '复制失败', message: '诊断信息复制失败', detail: '请检查剪贴板是否可用后重试。' }); return; }
  void dialog.showMessageBox({ type: 'info', title: '诊断信息已复制', message: '诊断信息已复制到剪贴板', detail: '包含客户端版本、当前服务地址和日志目录，不会自动发送。提交反馈前请检查内容。' });
}
function makeUpdater() {
  return createUpdater({ userData: app.getPath('userData'), currentVersion: app.getVersion(), showFile: file => shell.showItemInFolder(file) });
}
async function checkForUpdates() {
  if (updating) return;
  updating = true;
  const show = options => window && !window.isDestroyed() ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
  try {
    await runUpdate({ updater, show, open: url => shell.openExternal(url), status: label => { const item = Menu.getApplicationMenu()?.getMenuItemById('check-updates'); if (item) { item.label = label; item.enabled = label === '检查更新…'; } } });
  } finally { updating = false; }
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
