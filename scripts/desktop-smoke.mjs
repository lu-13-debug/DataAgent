import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const packagedExecutable = process.argv[2];
const executable = packagedExecutable ? path.resolve(packagedExecutable) : require('electron');
const directory = path.resolve('artifacts', `desktop-smoke-${packagedExecutable ? 'packaged' : 'development'}-${Date.now()}`);
await mkdir(directory, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const args = [...(packagedExecutable ? [] : ['.']), '--smoke-test', `--dataagent-user-data=${directory}`];
const child = spawn(executable, args, { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
const deadline = setTimeout(() => { child.kill(); }, 60000);
try {
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  if (code !== 0) console.error(output.slice(-4000));
  assert.equal(code, 0, `桌面启动应正常退出，实际 ${code}`);
  const result = JSON.parse(await readFile(path.join(directory, 'desktop-smoke-result.json'), 'utf8'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.nodeIsolated, true);
  assert.equal(result.skills, 8);
  assert.ok(result.metrics >= 8);
  assert.equal(result.packaged, Boolean(packagedExecutable));
  console.log(JSON.stringify(result, null, 2));
  console.log(`桌面实际启动验收通过；结果目录：${directory}`);
} finally { clearTimeout(deadline); }
