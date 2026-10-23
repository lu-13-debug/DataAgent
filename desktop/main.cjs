const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('node:path');
const { mkdirSync, appendFileSync, writeFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const { desktopPaths, allowedNavigation, safeExternalUrl } = require('./runtime.cjs');

app.setName('DataAgent');
app.setAppUserModelId('com.dataagent.desktop');
const smoke = process.argv.includes('--smoke-test');
const customData = process.argv.find(arg => arg.startsWith('--dataagent-user-data='));
if (customData) app.setPath('userData', path.resolve(customData.slice('--dataagent-user-data='.length)));
const paths = desktopPaths(app.getPath('userData'));
mkdirSync(paths.logs, { recursive: true });
const log = message => appendFileSync(path.join(paths.logs, 'desktop.log'), `${new Date().toISOString()} ${message}\n`);
let service, httpServer, window, origin, quitting = false;
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(start).catch(fail);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting || !httpServer) return;
    event.preventDefault(); quitting = true;
    const finish = () => { try { service?.locals.close(); } catch {} app.exit(0); };
    httpServer.close(finish);
    setTimeout(finish, 4000).unref();
  });
}

async function start() {
  log(`启动 DataAgent ${app.getVersion()} / Electron ${process.versions.electron} / Node ${process.versions.node}`);
  const { createApp } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'app.js')).href);
  service = createApp({ dataDir: paths.data, distDir: path.join(__dirname, '..', 'dist') });
  // Each application owns its local port; a running web development server cannot conflict.
  httpServer = await new Promise((resolve, reject) => {
    const server = service.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
  origin = `http://127.0.0.1:${httpServer.address().port}`;
  window = new BrowserWindow({
    title: 'DataAgent · 游戏数据分析', width: 1500, height: 960, minWidth: 1000, minHeight: 700,
    backgroundColor: '#f8f9fb', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false },
  });
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (details.url.startsWith(origin + '/')) headers['Content-Security-Policy'] = ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"];
    callback({ responseHeaders: headers });
  });
  window.webContents.setWindowOpenHandler(({ url }) => { const safe = safeExternalUrl(url); if (safe) void shell.openExternal(safe); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!allowedNavigation(url, origin)) event.preventDefault(); });
  window.webContents.on('render-process-gone', (_event, details) => { log(`界面进程退出：${details.reason}`); if (!quitting) dialog.showErrorBox('界面意外退出', '请重新启动 DataAgent，已保存的报告仍保留在本机。'); });
  window.webContents.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: '保存分析报告', defaultPath: path.join(app.getPath('downloads'), item.getFilename()), filters: [{ name: 'Markdown 报告', extensions: ['md'] }] });
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '退出 DataAgent', role: 'quit' }] },
    { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' }, { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }] },
    { label: '视图', submenu: [{ label: '重新载入', role: 'reload' }, { label: '实际大小', role: 'resetZoom' }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { label: '全屏', role: 'togglefullscreen' }] },
    { label: '帮助', submenu: [{ label: '打开数据目录', click: () => void shell.openPath(paths.data) }, { label: '关于 DataAgent', click: () => void dialog.showMessageBox(window, { type: 'info', title: '关于 DataAgent', message: 'DataAgent', detail: `版本 ${app.getVersion()}\n游戏运营 AI 数据分析工作台\n本地单用户版本 · 用户自带 API Key` }) }] },
  ]));
  await window.loadURL(origin);
  if (smoke) await smokeTest();
  else { window.show(); log('界面就绪，本地分析服务已启动。'); }
}

async function smokeTest() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const ready = await window.webContents.executeJavaScript("Boolean(document.querySelector('#main-content h1'))");
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const health = await fetch(origin + '/api/health').then(r => r.json());
  const bootstrap = await fetch(origin + '/api/bootstrap').then(r => r.json());
  const heading = await window.webContents.executeJavaScript("document.querySelector('#main-content h1')?.textContent || ''");
  const nodeIsolated = await window.webContents.executeJavaScript("typeof window.require === 'undefined' && typeof window.process === 'undefined'");
  if (!health.ok || !heading.includes('让数据') || !nodeIsolated || !bootstrap.tasks[0]?.report?.metrics?.length) throw new Error('打包运行验收失败：界面、计算、隔离或SQLite异常');
  const result = { ok: true, appVersion: app.getVersion(), electron: process.versions.electron, node: process.versions.node, heading, nodeIsolated, skills: bootstrap.skills.length, metrics: bootstrap.tasks[0].report.metrics.length, wallet: bootstrap.wallet, database: paths.data, packaged: app.isPackaged };
  writeFileSync(path.join(app.getPath('userData'), 'desktop-smoke-result.json'), JSON.stringify(result, null, 2));
  log('桌面启动验收通过。');
  app.quit();
}
function fail(error) {
  log(`启动失败：${error?.stack || error}`);
  if (smoke) { writeFileSync(path.join(app.getPath('userData'), 'desktop-smoke-result.json'), JSON.stringify({ ok: false, error: String(error?.message || error) })); app.exit(1); }
  else { dialog.showErrorBox('DataAgent 无法启动', `应用启动失败，请查看本机日志：\n${paths.logs}\n\n${error?.message || '未知错误'}`); app.exit(1); }
}
