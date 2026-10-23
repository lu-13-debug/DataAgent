const path = require('node:path');

function desktopPaths(userData) {
  return { data: path.join(userData, 'storage'), logs: path.join(userData, 'logs') };
}
function allowedNavigation(value, origin) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === origin; }
  catch { return false; }
}
function safeExternalUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
module.exports = { desktopPaths, allowedNavigation, safeExternalUrl };
