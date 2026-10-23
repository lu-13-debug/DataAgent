const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { desktopPaths, allowedNavigation, safeExternalUrl } = require('./runtime.cjs');

test('desktop runtime stores database under userData instead of installed program', () => {
  const p = desktopPaths('C:\\Users\\Test\\AppData\\Roaming\\DataAgent');
  assert.equal(p.data, path.join('C:\\Users\\Test\\AppData\\Roaming\\DataAgent', 'storage'));
  assert.equal(p.logs, path.join('C:\\Users\\Test\\AppData\\Roaming\\DataAgent', 'logs'));
});
test('desktop navigation is limited to the exact local service origin', () => {
  const origin = 'http://127.0.0.1:32145';
  assert.equal(allowedNavigation(origin + '/api/health', origin), true);
  assert.equal(allowedNavigation('http://127.0.0.1:32146', origin), false);
  assert.equal(allowedNavigation('https://example.com', origin), false);
  assert.equal(allowedNavigation('javascript:alert(1)', origin), false);
  assert.equal(allowedNavigation('file:///C:/Windows/system.ini', origin), false);
});
test('external links cannot launch system protocols or credential-bearing URLs', () => {
  assert.equal(safeExternalUrl('https://example.com/docs'), 'https://example.com/docs');
  for (const value of ['file:///C:/a.exe', 'ms-settings:privacy', 'javascript:alert(1)', 'https://user:pass@example.com']) assert.equal(safeExternalUrl(value), null);
});
