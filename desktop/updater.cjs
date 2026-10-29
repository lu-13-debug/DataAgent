'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const API = 'https://api.github.com/repos/lu-13-debug/DataAgent/releases/latest';
const RELEASES = 'https://github.com/lu-13-debug/DataAgent/releases/latest';
const MAX_DOWNLOAD = 512 * 1024 * 1024;
function version(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('版本号格式无效。');
  return value.split('.').map(BigInt);
}
function selectRelease(release, current) {
  const currentParts = version(current);
  if (!release || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') throw new Error('未找到可信的稳定版本。');
  const tag = release.tag_name;
  const v = tag.startsWith('v') ? tag.slice(1) : tag;
  const parts = version(v);
  let compare = 0;
  for (let i = 0; i < 3; i++) { if (parts[i] !== currentParts[i]) { compare = parts[i] > currentParts[i] ? 1 : -1; break; } }
  if (compare <= 0) return null;
  const name = `DataAgent-Setup-${v}-x64.exe`;
  const candidates = Array.isArray(release.assets) ? release.assets.filter(a => a.name === name) : [];
  if (candidates.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(candidates[0].digest || '')) throw new Error('发布文件缺少唯一的 SHA256 校验值，请手动下载。');
  const url = `https://github.com/lu-13-debug/DataAgent/releases/download/${tag}/${name}`;
  if (candidates[0].browser_download_url !== url) throw new Error('发布文件地址不可信，请手动下载。');
  return { version: v, name, url, digest: candidates[0].digest.slice(7) };
}
function allowed(url, kind, initial) {
  let u; try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  if (kind === 'api') return u.href === API;
  if (u.hostname === 'github.com') return u.href === initial;
  return ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(u.hostname);
}
async function requestBounded(url, { fetch: fetcher = fetch, limit, timeout, kind, onChunk }) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('下载或检查超时，请重试。')); }, timeout); });
  const work = async () => {
    let target = url;
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!allowed(target, kind, url)) throw new Error('更新地址或重定向不可信。');
      const res = await fetcher(target, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'DataAgent-Desktop', Accept: kind === 'api' ? 'application/vnd.github+json' : 'application/octet-stream' } });
      if (controller.signal.aborted) throw new Error('更新请求已取消。');
      if ([301, 302, 303, 307, 308].includes(res.status)) { const location = res.headers.get('location'); if (!location) throw new Error('重定向缺少地址。'); target = new URL(location, target).href; continue; }
      if (!res.ok || !res.body) throw new Error(`更新服务器响应失败 (${res.status})。`);
      const length = res.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || BigInt(length) > BigInt(limit))) throw new Error('更新响应超过大小限制。');
      let size = 0; const chunks = [];
      for await (const chunk of res.body) { if (controller.signal.aborted) throw new Error('更新请求已取消。'); size += chunk.length; if (size > limit) { controller.abort(); throw new Error('更新响应超过大小限制。'); } if (onChunk) await onChunk(chunk); else chunks.push(Buffer.from(chunk)); }
      return onChunk ? undefined : Buffer.concat(chunks);
    }
    throw new Error('重定向次数过多。');
  };
  try { return await Promise.race([work(), deadline]); } finally { clearTimeout(timer); controller.abort(); }
}
function createUpdater({ fetch: fetcher = fetch, userData, currentVersion, showFile }) {
  let selected = null, verified = null, busy = false;
  const base = path.join(userData, 'updates');
  async function safeBase() {
    await fs.mkdir(base, { recursive: true });
    const info = await fs.lstat(base);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('更新目录不安全。');
  }
  async function removeOwned(name) {
    if (!/^download-[a-f0-9]{32}$/.test(name)) return;
    const dir = path.join(base, name), marker = path.join(dir, '.dataagent-update.json');
    try {
      const info = await fs.lstat(dir), markInfo = await fs.lstat(marker);
      if (!info.isDirectory() || info.isSymbolicLink() || !markInfo.isFile() || markInfo.isSymbolicLink() || markInfo.size > 1024) return;
      const data = JSON.parse(await fs.readFile(marker, 'utf8'));
      if (!data || typeof data !== 'object' || data.token !== name.slice(9) || typeof data.file !== 'string' || !/^DataAgent-Setup-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-x64\.exe$/.test(data.file)) return;
      const file = path.join(dir, data.file);
      try { const item = await fs.lstat(file); if (!item.isFile() || item.isSymbolicLink()) return; await fs.unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const entries = await fs.readdir(dir);
      if (entries.length !== 1 || entries[0] !== '.dataagent-update.json') return;
      await fs.unlink(marker); await fs.rmdir(dir);
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  }
  async function exclusive(fn) { if (busy) throw new Error('更新操作正在进行，请稍候。'); busy = true; try { return await fn(); } finally { busy = false; } }
  async function cleanup() { if (verified) { const name = path.basename(verified.dir); verified = null; await safeBase(); await removeOwned(name); } }
  return {
    initialize: () => exclusive(async () => { await safeBase(); for (const name of await fs.readdir(base)) await removeOwned(name); }),
    ready: () => verified && { version: verified.version },
    check: () => exclusive(async () => {
      await cleanup(); selected = null;
      const raw = await requestBounded(API, { fetch: fetcher, limit: 1024 * 1024, timeout: 30000, kind: 'api' });
      selected = selectRelease(JSON.parse(raw.toString('utf8')), currentVersion); return selected && { version: selected.version };
    }),
    download: () => exclusive(async () => {
      if (!selected) throw new Error('请先检查更新。');
      await cleanup();
      await safeBase();
      const token = crypto.randomBytes(16).toString('hex');
      const dir = path.join(base, `download-${token}`); await fs.mkdir(dir);
      const file = path.join(dir, selected.name);
      let handle;
      try {
        await fs.writeFile(path.join(dir, '.dataagent-update.json'), JSON.stringify({ token, file: selected.name }), { flag: 'wx', mode: 0o600 });
        handle = await fs.open(file, 'wx', 0o600); const hash = crypto.createHash('sha256');
        await requestBounded(selected.url, { fetch: fetcher, limit: MAX_DOWNLOAD, timeout: 5 * 60 * 1000, kind: 'asset', onChunk: async chunk => { hash.update(chunk); await handle.writeFile(chunk); } });
        await handle.close(); handle = null;
        if (hash.digest('hex') !== selected.digest) throw new Error('下载文件 SHA256 不匹配，请重试或手动下载。');
        verified = { dir, file, digest: selected.digest, version: selected.version }; return { version: selected.version };
      } catch (error) { if (handle) await handle.close().catch(() => {}); await removeOwned(path.basename(dir)).catch(() => {}); throw error; }
    }),
    reveal: () => exclusive(async () => {
      if (!verified) throw new Error('尚无已验证的安装包，请重新下载。');
      try {
        const info = await fs.lstat(verified.file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_DOWNLOAD) throw new Error('安装包已发生变化，请重新下载。');
        const hash = crypto.createHash('sha256');
        const handle = await fs.open(verified.file, 'r');
        try { for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); } finally { await handle.close(); }
        if (hash.digest('hex') !== verified.digest) throw new Error('安装包校验失败，请重新下载。');
      } catch (error) {
        await cleanup().catch(() => {});
        throw error;
      }
      await showFile(verified.file);
    }),
    verifiedPath: () => verified?.file,
  };
}
module.exports = { selectRelease, requestBounded, createUpdater, RELEASES };
