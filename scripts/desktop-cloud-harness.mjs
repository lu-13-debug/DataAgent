import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function desktopEnvironment(serverUrl) {
  const env = { ...process.env, DATAAGENT_SERVER_URL: serverUrl };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
export async function startCloudFixture(directory) {
  const env = { ...process.env, NODE_ENV: 'test', PUBLIC_URL: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = fork(path.join(root, 'scripts', 'desktop-cloud-fixture.mjs'), [path.join(directory, 'server-data')], { cwd: root, env, execArgv: [], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  let origin;
  try {
    origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('独立云端验收服务启动超时。\n' + output)), 15000);
      const finish = callback => value => { clearTimeout(timer); callback(value); };
      child.once('error', finish(reject));
      child.once('exit', finish(code => reject(new Error(`云端验收服务提前退出（${code}）。\n${output}`))));
      child.on('message', message => {
        if (message?.type === 'ready') finish(resolve)(message.origin);
        else if (message?.type === 'error') finish(reject)(new Error(message.error));
      });
    });
    const runtime = await fetch(origin + '/api/runtime', { signal: AbortSignal.timeout(5000) }).then(response => response.json());
    if (runtime.mode !== 'cloud' || runtime.authRequired !== true || runtime.serviceName !== 'DataAgent') throw new Error('验收只能使用真实云端账号服务。');
  } catch (error) { child.kill(); throw error; }
  return {
    origin,
    close: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill(); resolve(); }, 6000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.send({ type: 'close' }, () => {});
      });
    },
  };
}
