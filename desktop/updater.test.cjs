const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { selectRelease, requestBounded, createUpdater } = require('./updater.cjs');
const bytes = Buffer.from('verified installer');
const digest = 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
const release = (overrides = {}) => ({ tag_name: 'v1.2.0', draft: false, prerelease: false, assets: [{ name: 'DataAgent-Setup-1.2.0-x64.exe', digest, browser_download_url: 'https://github.com/lu-13-debug/DataAgent/releases/download/v1.2.0/DataAgent-Setup-1.2.0-x64.exe' }], ...overrides });
const response = (body, options = {}) => new Response(body, options);
test('accepts only newer stable exact asset with official SHA256', () => {
  assert.equal(selectRelease(release(), '1.1.0').version, '1.2.0');
  for (const item of [release({draft:true}), release({prerelease:true}), release({tag_name:'v1.2.0-rc.1'}), release({assets:[]}), release({assets:[{...release().assets[0], digest:null}]}), release({assets:[{...release().assets[0], browser_download_url:'https://evil.test/file.exe'}]})]) assert.throws(() => selectRelease(item, '1.1.0'));
  assert.equal(selectRelease(release(), '1.2.0'), null);
  assert.equal(selectRelease(release(), '1.10.0'), null);
});
test('rejects unsafe redirects and oversized bodies', async () => {
  await assert.rejects(requestBounded('https://api.github.com/repos/lu-13-debug/DataAgent/releases/latest', { fetch: async () => response('', {status:302, headers:{location:'https://evil.test'}}), limit:20, timeout:1000, kind:'api' }));
  await assert.rejects(requestBounded('https://api.github.com/repos/lu-13-debug/DataAgent/releases/latest', { fetch: async () => response('123456'), limit:5, timeout:1000, kind:'api' }));
});
test('requires verified bytes and a second verification before reveal', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dataagent-update-test-'));
  let launched = 0;
  const fetch = async url => url.includes('api.github.com') ? response(JSON.stringify(release())) : response(bytes);
  const updater = createUpdater({fetch, userData:dir, currentVersion:'1.1.0', showFile: () => { launched++; }});
  try {
    await updater.check(); await updater.download();
    const file = updater.verifiedPath();
    await fs.writeFile(file, 'tampered');
    await assert.rejects(updater.reveal()); assert.equal(launched, 0);
  } finally { await fs.rm(dir, {recursive:true, force:true}); }
});
test('download digest mismatch cannot reveal', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dataagent-update-test-'));
  let launched = 0;
  const updater = createUpdater({fetch: async url => url.includes('api.github.com') ? response(JSON.stringify(release())) : response('wrong'), userData:dir, currentVersion:'1.1.0', showFile: () => { launched++; }});
  try { await updater.check(); await assert.rejects(updater.download()); await assert.rejects(updater.reveal()); assert.equal(launched,0); }
  finally { await fs.rm(dir, {recursive:true, force:true}); }
});
test('update flow requires explicit reveal and warns about active tasks', async () => {
  const { runUpdate } = require('./update-ui.cjs');
  const choices = [0, 1]; const dialogs = []; let installs = 0;
  await runUpdate({ updater: { check: async () => ({version:'1.2.0'}), download: async () => {}, reveal: async () => { installs++; } }, show: async options => { dialogs.push(options); return {response: choices.shift()}; }, open: async () => {} });
  assert.equal(installs, 0);
  assert.match(dialogs[1].detail, /任务|会话/);
  choices.push(0, 0);
  await runUpdate({ updater: { check: async () => ({version:'1.2.0'}), download: async () => {}, reveal: async () => { installs++; } }, show: async () => ({response: choices.shift()}), open: async () => {} });
  assert.equal(installs, 1);
});
test('failed update offers only fixed manual release page', async () => {
  const { runUpdate } = require('./update-ui.cjs'); let opened;
  await runUpdate({ updater: { check: async () => { throw new Error('offline'); } }, show: async () => ({response:0}), open: async url => {opened = url;} });
  assert.equal(opened, 'https://github.com/lu-13-debug/DataAgent/releases/latest');
});
test('reports check and download progress to the native menu', async () => {
  const { runUpdate } = require('./update-ui.cjs'); const statuses = [];
  await runUpdate({ updater: { check: async () => ({version:'1.2.0'}), download: async () => {}, reveal: async () => {} }, show: async () => ({response:0}), open: async () => {}, status: value => statuses.push(value) });
  assert.deepEqual(statuses, ['正在检查更新…', '正在下载更新…', '检查更新…']);
});
test('times out stalled network and rejects overlapping operations', async () => {
  await assert.rejects(requestBounded('https://api.github.com/repos/lu-13-debug/DataAgent/releases/latest', { fetch: () => new Promise(() => {}), limit:100, timeout:15, kind:'api' }), /超时/);
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const updater = createUpdater({fetch: () => pending, userData:os.tmpdir(), currentVersion:'1.1.0', showFile: () => {}});
  const first = updater.check(); await assert.rejects(updater.check(), /正在进行/);
  finish(response(JSON.stringify(release()))); await first;
});
test('late network response after timeout cannot write download chunks', async () => {
  let resolveResponse; let writes = 0;
  const pending = new Promise(resolve => { resolveResponse = resolve; });
  const request = requestBounded('https://github.com/lu-13-debug/DataAgent/releases/download/v1.2.0/DataAgent-Setup-1.2.0-x64.exe', { fetch: () => pending, limit:100, timeout:15, kind:'asset', onChunk: async () => { writes++; } });
  await assert.rejects(request, /超时/);
  resolveResponse(response('late'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(writes, 0);
});
test('real updater keeps verified download after later and asks again without redownloading', async () => {
  const { runUpdate } = require('./update-ui.cjs'); const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dataagent-later-'));
  let requests = 0, launches = 0; const messages = [], choices = [0, 1, 0];
  const updater = createUpdater({userData:dir, currentVersion:'1.1.0', showFile: () => { launches++; }, fetch: async url => { requests++; return url.includes('api.github.com') ? response(JSON.stringify(release())) : response(bytes); }});
  try {
    await runUpdate({updater, show: async opts => { messages.push(opts); return {response:choices.shift()}; }, open: async () => {}});
    assert.equal(launches, 0); assert.ok(updater.verifiedPath());
    await runUpdate({updater, show: async opts => { messages.push(opts); return {response:choices.shift()}; }, open: async () => {}});
    assert.equal(launches, 1); assert.equal(requests, 2); assert.match(messages[2].message, /已通过 SHA256/);
  } finally { await fs.rm(dir, {recursive:true, force:true}); }
});
test('restart removes only marked owned download and never executes stale file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dataagent-restart-')); let launches = 0;
  const options = {userData:dir, currentVersion:'1.1.0', showFile: () => { launches++; }, fetch: async url => url.includes('api.github.com') ? response(JSON.stringify(release())) : response(bytes)};
  try {
    const first = createUpdater(options); await first.initialize(); await first.check(); await first.download(); const previous = first.verifiedPath();
    const unknown = path.join(dir, 'updates', 'download-unknown'); await fs.mkdir(unknown); await fs.writeFile(path.join(unknown, 'keep.txt'), 'keep');
    const second = createUpdater(options); await second.initialize();
    await assert.rejects(fs.stat(previous), {code:'ENOENT'}); assert.equal(await fs.readFile(path.join(unknown, 'keep.txt'), 'utf8'), 'keep');
    await assert.rejects(second.reveal()); assert.equal(launches, 0);
  } finally { await fs.rm(dir, {recursive:true, force:true}); }
});
test('invalidated downloads can be checked and downloaded again after missing, non-file, or unreadable installer', async () => {
  const { runUpdate } = require('./update-ui.cjs');
  for (const fault of ['missing', 'directory', 'unreadable']) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dataagent-invalid-')); let requests = 0, launches = 0;
    const updater = createUpdater({userData:dir, currentVersion:'1.1.0', showFile: () => { launches++; }, fetch: async url => { requests++; return url.includes('api.github.com') ? response(JSON.stringify(release())) : response(bytes); }});
    const choices = [0, 1]; const show = async () => ({response:choices.shift()}); const open = async () => {};
    let originalOpen;
    try {
      await runUpdate({updater, show, open}); const file = updater.verifiedPath();
      if (fault === 'missing') await fs.unlink(file);
      if (fault === 'directory') { await fs.unlink(file); await fs.mkdir(file); await fs.writeFile(path.join(file, 'unknown.txt'), 'keep'); }
      if (fault === 'unreadable') { originalOpen = fs.open; fs.open = async (name, flags, ...args) => { if (name === file && flags === 'r') { const error = new Error('access denied'); error.code = 'EACCES'; throw error; } return originalOpen(name, flags, ...args); }; }
      choices.push(0, 1); await runUpdate({updater, show, open});
      if (originalOpen) { fs.open = originalOpen; originalOpen = null; }
      assert.equal(updater.ready(), null, fault); assert.equal(launches, 0, fault);
      choices.push(0, 1); await runUpdate({updater, show, open});
      assert.equal(requests, 4, fault); assert.ok(updater.ready(), fault);
      if (fault === 'directory') assert.equal(await fs.readFile(path.join(file, 'unknown.txt'), 'utf8'), 'keep');
    } finally { if (originalOpen) fs.open = originalOpen; await fs.rm(dir, {recursive:true, force:true}); }
  }
});
test('manual update only reveals internally verified file after explicit user choice', async () => {
  const { runUpdate } = require('./update-ui.cjs'); const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dataagent-manual-'));
  const shown = []; const dialogs = []; const choices = [0, 1, 0];
  const updater = createUpdater({userData:dir, currentVersion:'1.1.0', showFile: file => { shown.push(file); }, fetch: async url => url.includes('api.github.com') ? response(JSON.stringify(release())) : response(bytes)});
  const show = async opts => { dialogs.push(opts); return {response:choices.shift()}; };
  try {
    await runUpdate({updater, show, open: async () => {}}); assert.deepEqual(shown, []);
    await runUpdate({updater, show, open: async () => {}});
    assert.deepEqual(shown, [updater.verifiedPath()]);
    assert.match(dialogs[1].detail, /同一账号/); assert.match(dialogs[1].detail, /未签名/);
    assert.equal(typeof updater.install, 'undefined');
  } finally { await fs.rm(dir, {recursive:true, force:true}); }
});
test('manual reveal ignores caller supplied paths and preserves saved copies during cleanup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dataagent-save-')); const shown = [];
  const options = {userData:dir, currentVersion:'1.1.0', showFile: file => { shown.push(file); }, fetch: async url => url.includes('api.github.com') ? response(JSON.stringify(release())) : response(bytes)};
  try {
    const updater = createUpdater(options); await updater.initialize(); await updater.check(); await updater.download();
    const file = updater.verifiedPath(), saved = path.join(dir, 'my-installer.exe'), extra = path.join(path.dirname(file), 'my-copy.exe');
    await fs.copyFile(file, saved); await fs.copyFile(file, extra);
    await updater.reveal('C:\\untrusted\\other.exe'); assert.deepEqual(shown, [file]);
    await createUpdater(options).initialize();
    assert.deepEqual(await fs.readFile(saved), bytes); assert.deepEqual(await fs.readFile(extra), bytes);
  } finally { await fs.rm(dir, {recursive:true, force:true}); }
});
