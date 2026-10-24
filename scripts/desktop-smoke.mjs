import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, desktopEnvironment, startCloudFixture } from './desktop-cloud-harness.mjs';

const executable = path.resolve(process.argv[2] || path.join(root, 'release/win-unpacked/DataAgent.exe'));
const directory = path.join(root, 'artifacts', `desktop-smoke-cloud-${Date.now()}`);
await mkdir(directory, { recursive: true });
const fixture = await startCloudFixture(directory);
let child, deadline, output = '';
try {
  child = spawn(executable, ['--smoke-test', `--dataagent-user-data=${path.join(directory, 'client')}`], { cwd: root, env: desktopEnvironment(fixture.origin), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  deadline = setTimeout(() => child.kill(), 60000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0, `桌面启动应正常退出，实际 ${code}\n${output.slice(-4000)}`);
  const result = JSON.parse(await readFile(path.join(directory, 'client', 'desktop-smoke-result.json'), 'utf8'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.mode, 'cloud');
  assert.equal(result.serverUrl, fixture.origin);
  assert.equal(result.nodeIsolated, true);
  assert.equal(result.loginPage, true);
  assert.equal(result.anonymousStatus, 401);
  assert.equal(result.packaged, true, '冒烟验收必须使用真实打包程序');
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, directory }, null, 2));
  console.log('云端桌面启动验收通过；完整注册与分析流程请运行 desktop-check.mjs。');
} finally {
  clearTimeout(deadline);
  if (child && child.exitCode === null && child.signalCode === null) child.kill();
  await writeFile(path.join(directory, 'process.log'), output);
  await fixture.close();
}
