const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppearancePolicy } = require('./appearance.cjs');
test('桌面主题仅接受当前服务的主框架和三种合法选项', () => {
  const frame={url:'https://trusted.example/'};const contents={mainFrame:frame,send(){}};let bg;const win={webContents:contents,isDestroyed:()=>false,setBackgroundColor(value){bg=value;}};const nativeTheme={themeSource:'system',shouldUseDarkColors:true};
  const policy=createAppearancePolicy({nativeTheme,getWindow:()=>win,getOrigin:()=> 'https://trusted.example'});
  assert.equal(policy.set({sender:contents,senderFrame:{}},'light'),false);
  assert.equal(policy.set({sender:contents,senderFrame:frame},'other'),false);
  assert.equal(policy.set({sender:contents,senderFrame:frame},'dark'),true);assert.equal(nativeTheme.themeSource,'dark');assert.equal(bg,'#0d1110');
});
