const { allowedNavigation } = require('./runtime.cjs');
function trustedSender(event, contents, origin) {
  return Boolean(origin && contents && event.sender === contents && event.senderFrame === contents.mainFrame && allowedNavigation(event.senderFrame?.url, origin));
}
function validateSummaries(value) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'id,status,title' || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 128 || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120 || !['running', 'awaiting_approval'].includes(item.status)) return null;
    result.push({ id: item.id, title: item.title, status: item.status });
  }
  return result;
}
function createTrayController({ create, buildMenu, show, newAnalysis, quit, save, initialCloseToTray = false }) {
  let tray = null, closeToTray = initialCloseToTray, summaries = [], state = 'unsupported';
  function refresh() {
    if (!tray) return;
    const items = summaries.map(item => ({ label: `${item.status === 'running' ? '运行中' : '待确认'}：${item.title.replace(/[\r\n\t]/g, ' ')}`, enabled: false }));
    const label = state === 'login' ? '请先登录工作台' : state === 'ready' ? '暂无运行或待确认任务' : '当前服务版本不支持托盘任务，请更新服务';
    tray.setContextMenu(buildMenu([{ label: '显示窗口', click: show }, { label: '新建分析', enabled: state === 'ready', click: () => { if (state === 'ready') newAnalysis?.(); } }, { type: 'separator' }, ...(state === 'ready' && items.length ? items : [{ label, enabled: false }]), { type: 'separator' }, { label: '关闭窗口时最小化到托盘', type: 'checkbox', checked: closeToTray, click: item => { try { save(item.checked); closeToTray = item.checked; } catch {} safeRefresh(); } }, { label: '退出 DataAgent', click: quit }]));
  }
  function failed() {
    try { tray?.destroy(); } catch {} tray = null;
    try { show?.(); } catch {} // A hidden window must remain reachable if the tray disappears.
  }
  function safeRefresh() { try { refresh(); } catch { failed(); } }
  return {
    start() { try { tray = create(); tray.setToolTip('DataAgent'); tray.on('click', show); refresh(); return true; } catch { failed(); return false; } },
    update(value) { if (state !== 'ready') return; summaries = value; safeRefresh(); },
    setState(value) { state = value; if (value !== 'ready') summaries = []; safeRefresh(); },
    clear() { summaries = []; state = 'unsupported'; safeRefresh(); },
    shouldHide() { return Boolean(tray && closeToTray); },
    destroy() { try { tray?.destroy(); } catch {} tray = null; summaries = []; },
  };
}
module.exports = { trustedSender, validateSummaries, createTrayController };
