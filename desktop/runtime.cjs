const path = require('node:path');
const { mkdir, readFile, writeFile, rename } = require('node:fs/promises');

function desktopPaths(userData) {
  return { data: path.join(userData, 'storage'), logs: path.join(userData, 'logs') };
}
function allowedNavigation(value, origin) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === origin; }
  catch { return false; }
}
function safeExternalUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function normalizeServerUrl(value) {
  if (typeof value !== 'string') throw new Error('请输入服务地址。');
  const raw = value.trim();
  const parts = /^(https?):\/\/([^/?#\\\s]+)\/?$/i.exec(raw);
  if (!parts) throw new Error('请填写 HTTPS 根地址，不含路径、查询或片段。');
  let url;
  try { url = new URL(raw); } catch { throw new Error('服务地址格式不正确。'); }
  if (url.username || url.password || parts[2].includes('@')) throw new Error('服务地址不能包含账号或密码。');
  if (url.protocol === 'http:') {
    const host = parts[2].replace(/:\d+$/, '').toLowerCase();
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new Error('只有本机开发服务可以使用 HTTP，其他服务必须使用 HTTPS。');
  }
  return url.origin;
}
function buildSupportDiagnostic({ version, origin, logs }) {
  let serverOrigin = '未连接';
  try {
    const normalized = normalizeServerUrl(origin);
    if (normalized === origin) serverOrigin = normalized;
  } catch { /* 未连接或无效地址不进入诊断信息 */ }
  return JSON.stringify({ version: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version) ? version : 'unknown', serverOrigin, logDirectory: logs }, null, 2);
}
function resolveServerUrl({ environmentUrl, savedUrl, bundledUrl } = {}) {
  for (const value of [environmentUrl, savedUrl, bundledUrl]) {
    if (value !== undefined && value !== null && value !== '') return normalizeServerUrl(value);
  }
  return null;
}
async function loadServerUrl({ environmentUrl, connectionFile, bundledFile }) {
  if (environmentUrl) return normalizeServerUrl(environmentUrl);
  const read = async file => {
    try { return JSON.parse(await readFile(file, 'utf8'))?.serverUrl; }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw new Error('连接配置无法读取，请重新填写服务地址。'); }
  };
  const savedUrl = await read(connectionFile);
  if (savedUrl) return normalizeServerUrl(savedUrl);
  return resolveServerUrl({ bundledUrl: await read(bundledFile) });
}
function isConnectionSender(event, contents, connectionUrl) {
  return Boolean(contents && event.sender === contents && event.senderFrame === contents.mainFrame && event.senderFrame?.url === connectionUrl);
}
async function probeCloudServer(value, fetchImpl = fetch) {
  const origin = normalizeServerUrl(value);
  const response = await fetchImpl(origin + '/api/runtime', { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`服务连接失败（HTTP ${response.status}），请检查地址后重试。`);
  const runtime = await response.json();
  if (runtime?.mode !== 'cloud' || runtime.authRequired !== true || runtime.serviceName !== 'DataAgent') throw new Error('目标不是 DataAgent 云端账号服务，请确认服务地址。');
  return origin;
}
async function saveCloudConnection(file, value, fetchImpl = fetch) {
  const serverUrl = await probeCloudServer(value, fetchImpl);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  await writeFile(temporary, JSON.stringify({ serverUrl }, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
  return serverUrl;
}
module.exports = { desktopPaths, allowedNavigation, safeExternalUrl, normalizeServerUrl, buildSupportDiagnostic, resolveServerUrl, loadServerUrl, isConnectionSender, probeCloudServer, saveCloudConnection };
