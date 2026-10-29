import type { Dataset } from './types';

export interface UploadOptions { signal?: AbortSignal; onProgress?: (percent: number | null) => void; onUnauthorized?: () => void }
export function uploadFiles(files: File[], options: UploadOptions = {}, createRequest: () => XMLHttpRequest = () => new XMLHttpRequest()): Promise<{ dataset: Dataset }> {
  return new Promise((resolve, reject) => {
    if (!files.length || files.length > 3 || files.reduce((size, file) => size + file.size, 0) > 20 * 1024 * 1024) { reject(new Error('请选择 1 至 3 个文件，总大小不能超过 20MB。')); return; }
    if (options.signal?.aborted) { reject(new DOMException('上传已取消', 'AbortError')); return; }
    const xhr = createRequest(); let settled = false;
    const cleanup = () => options.signal?.removeEventListener('abort', cancel);
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const cancel = () => { xhr.abort(); fail(new DOMException('上传已取消', 'AbortError')); };
    xhr.open('POST', '/api/datasets/upload'); xhr.withCredentials = true; xhr.timeout = 120000;
    xhr.upload.onprogress = event => options.onProgress?.(event.lengthComputable ? Math.min(100, Math.round(event.loaded / event.total * 100)) : null);
    xhr.upload.onload = () => options.onProgress?.(100);
    xhr.onerror = () => fail(new Error('上传连接中断，请检查网络后重试；文件尚未确认导入成功。'));
    xhr.ontimeout = () => fail(new Error('上传或识别超时，请检查网络、缩小文件后重试。'));
    xhr.onabort = () => fail(new DOMException('上传已取消', 'AbortError'));
    xhr.onload = () => {
      if (settled || options.signal?.aborted) return;
      let body; try { body = JSON.parse(xhr.responseText); } catch { fail(new Error('服务未返回有效的识别结果，请重试。')); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        if (xhr.status === 401) options.onUnauthorized?.();
        const error = Object.assign(new Error(body?.error || `上传失败（${xhr.status}）。`), { issues: Array.isArray(body?.issues) ? body.issues : [] }); fail(error); return;
      }
      if (!body?.dataset?.id) { fail(new Error('服务未返回有效的数据集，请重试。')); return; }
      settled = true; cleanup(); resolve(body);
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    const body = new FormData(); files.forEach(file => body.append('files', file));
    try { xhr.send(body); } catch { fail(new Error('无法发起上传，请检查文件和网络后重试。')); }
  });
}
