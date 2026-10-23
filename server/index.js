import { createApp } from './app.js';

const port = Number(process.env.PORT || 3001);
const app = createApp();
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`DataAgent 已启动：http://127.0.0.1:${port}`);
});
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => { app.locals.close(); process.exit(0); });
  setTimeout(() => { app.locals.close(); process.exit(0); }, 5000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
