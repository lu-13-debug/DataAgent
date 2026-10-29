const { trustedSender } = require('./tray.cjs');
function createAppearancePolicy({ nativeTheme, getWindow, getOrigin }) {
  function update() {
    const win = getWindow(); if (!win || win.isDestroyed() || !trustedSender({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, win.webContents, getOrigin())) return;
    win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0d1110' : '#f2f4f3');
    win.webContents.send('appearance:system-theme', nativeTheme.shouldUseDarkColors);
  }
  return {
    set(event, theme) {
      const win = getWindow();
      if (!win || win.isDestroyed() || !trustedSender(event, win.webContents, getOrigin()) || !['light','dark','system'].includes(theme)) return false;
      nativeTheme.themeSource = theme; update(); return true;
    },
    update,
  };
}
module.exports = { createAppearancePolicy };
