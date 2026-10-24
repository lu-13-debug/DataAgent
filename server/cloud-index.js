import { createCloudApp } from './cloud-app.js';

const port = Number(process.env.PORT || 3002);
const host = process.env.HOST || '127.0.0.1';
const app = createCloudApp();
const server = app.listen(port, host, () => console.log(`DataAgent 云端服务已启动，监听 ${host}:${port}`));
server.requestTimeout = 120000;
server.headersTimeout = 15000;
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => { app.locals.close(); process.exit(0); });
  setTimeout(() => { app.locals.close(); process.exit(0); }, 10000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
