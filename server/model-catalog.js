import { normalizeBaseUrl, validateKey } from './gateway.js';

const maxBytes = 2 * 1024 * 1024;
async function readPage(response) {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('模型列表内容过大'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('模型列表为空或格式不兼容');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('模型列表内容过大'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('模型列表接口未返回有效 JSON，可手动填写模型名称'); }
  if (!Array.isArray(data?.data)) throw new Error('模型列表格式不兼容，可手动填写模型名称');
  return data;
}

export async function listModels({ settings, key, signal, fetchImpl = fetch, timeoutMs = 15000 }) {
  key = validateKey(key);
  if (!key) throw new Error('请先填写 API Key，再检测模型');
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const claude = new URL(baseUrl).hostname === 'api.anthropic.com';
  const headers = { authorization: `Bearer ${key}`, ...(claude ? { 'anthropic-version': '2026-10-21' } : {}) };
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const models = new Map(); const cursors = new Set(); let cursor = ''; let partial = false;
  try {
    for (let page = 0; page < 10; page++) {
      const url = new URL(`${baseUrl}/models`);
      if (claude) { url.searchParams.set('limit', '100'); if (cursor) url.searchParams.set('after_id', cursor); }
      const response = await fetchImpl(url.toString(), { method: 'GET', headers, redirect: 'error', signal: combined });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) throw new Error('模型列表获取失败：API Key 无效或没有读取权限，请检查凭据');
        if ([404, 405].includes(response.status)) throw new Error('模型服务不支持列出模型，可手动填写模型名称');
        if (response.status === 429) throw new Error('模型服务请求过于频繁，请稍后重新检测');
        throw new Error(`模型列表获取失败（HTTP ${response.status}），请检查供应商服务`);
      }
      const data = await readPage(response);
      for (const [index, item] of data.data.entries()) {
        const id = typeof item?.id === 'string' ? item.id.trim() : '';
        if (!id || id.length > 200 || /[\r\n]/.test(id) || id.includes(key)) continue;
        const rawName = item.display_name || item.name || id;
        const name = typeof rawName === 'string' && !rawName.includes(key) ? rawName.slice(0, 200) : id;
        if (!models.has(id)) models.set(id, { id, name });
        if (models.size >= 1000) { partial = index < data.data.length - 1; break; }
      }
      if (!data.has_more) break;
      if (!claude || models.size >= 1000 || page === 9) { partial = true; break; }
      if (typeof data.last_id !== 'string' || !data.last_id || data.last_id.length > 200 || cursors.has(data.last_id)) throw new Error('模型列表分页无效，请手动填写模型名称');
      cursor = data.last_id; cursors.add(cursor);
    }
    return { baseUrl, models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)), partial };
  } catch (error) {
    if (combined.aborted) throw new Error(signal?.aborted ? '模型检测已取消' : '模型列表检测超时，请稍后重试或手动填写');
    if (/^模型/.test(error.message)) throw error;
    throw new Error('模型列表连接失败，请检查 API 地址、网络和证书');
  }
}
