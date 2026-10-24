// This is an external Node process used only by acceptance scripts, never by the desktop client.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let service, server, closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const timer = setTimeout(() => process.exit(1), 5000);
  try {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    service?.locals.close();
    clearTimeout(timer); process.exit(0);
  } catch (error) { console.error(error); process.exit(1); }
}
process.on('message', message => { if (message?.type === 'close') void close(); });
process.on('disconnect', close);
process.on('SIGTERM', close);
process.on('SIGINT', close);
try {
  const dataDir = path.resolve(process.argv[2]);
  await mkdir(dataDir, { recursive: true });
  const { createCloudApp } = await import('../server/cloud-app.js');
  service = createCloudApp({ dataDir, distDir: path.join(root, 'dist'), production: false, modelHosts: [] });
  server = await new Promise((resolve, reject) => {
    const listener = service.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.send?.({ type: 'ready', origin });
} catch (error) {
  process.send?.({ type: 'error', error: `云端验收服务启动失败，请先完成 server/cloud-app.js 的 createCloudApp：${error.message}` });
  service?.locals.close();
  process.exit(1);
}
