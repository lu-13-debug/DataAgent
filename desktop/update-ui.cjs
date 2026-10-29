'use strict';
const { RELEASES } = require('./updater.cjs');
async function runUpdate({ updater, show, open, status = () => {} }) {
  try {
    let release = updater.ready?.();
    if (!release) {
      status('正在检查更新…');
      release = await updater.check();
      if (!release) { await show({ type: 'info', title: '检查更新', message: '当前已是最新稳定版本。', buttons: ['确定'] }); return; }
      const choice = await show({ type: 'question', title: '发现更新', message: `发现 DataAgent ${release.version}`, detail: '下载可能需要几分钟。下载后将验证 SHA256，并提供手动安装方式。', buttons: ['下载更新', '稍后'], defaultId: 1, cancelId: 1 });
      if (choice.response !== 0) return;
      status('正在下载更新…');
      await updater.download();
    }
    const choice = await show({ type: 'question', title: '更新已下载', message: `DataAgent ${release.version} 已通过 SHA256 校验。`, detail: '选择“显示文件”后可自行安装，安装或重启可能中断正在进行的任务或会话，请先保存工作。SHA256 只验证一致性，不能证明发布者身份；安装包未签名，Windows SmartScreen 可能提示风险。同一账号下的其他程序仍可能在校验后替换文件，请在安装前自行确认。选择稍后可在本次运行期间再次定位；下次启动会清理此临时下载，如需保留请先复制到其他目录。', buttons: ['显示文件', '稍后'], defaultId: 1, cancelId: 1 });
    if (choice.response === 0) await updater.reveal();
  } catch {
    const result = await show({ type: 'warning', title: '更新未完成', message: '无法检查、下载或验证更新。', detail: '请检查网络后重试，或前往官方发布页面手动下载并校验。安装包尚未签名，Windows SmartScreen 可能提示风险。', buttons: ['打开官方发布页面', '关闭'], defaultId: 1, cancelId: 1 });
    if (result.response === 0) await open(RELEASES);
  } finally { status('检查更新…'); }
}
module.exports = { runUpdate };
