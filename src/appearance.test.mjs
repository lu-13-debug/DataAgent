import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceKey, readAppearance, saveAppearance, resolveAppearance } from './appearance.ts';

test('外观按来源和账号隔离，缺省跟随系统且正常视图', () => {
  const data = new Map(); const storage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v) };
  assert.deepEqual(readAppearance(storage,'https://example.com','u1'), {theme:'system',view:'standard'});
  saveAppearance(storage,'https://example.com','u1',{theme:'dark',view:'concise'});
  assert.deepEqual(readAppearance(storage,'https://example.com','u1'),{theme:'dark',view:'concise'});
  assert.deepEqual(readAppearance(storage,'https://example.com','u2'),{theme:'system',view:'standard'});
  assert.notEqual(appearanceKey('https://example.com','u1'),appearanceKey('https://else.example','u1'));
  assert.notEqual(appearanceKey('https://example.com','u1'),appearanceKey('https://example.com',undefined));
});
test('系统偏好、固定主题和异常配置的回退', () => {
  assert.deepEqual(resolveAppearance({theme:'system',view:'concise'},true), {theme:'system',resolvedTheme:'dark',view:'concise'});
  assert.equal(resolveAppearance({theme:'system',view:'standard'},false).resolvedTheme,'light');
  assert.equal(resolveAppearance({theme:'light',view:'standard'},true).resolvedTheme,'light');
  assert.equal(resolveAppearance({theme:'dark',view:'standard'},false).resolvedTheme,'dark');
  assert.deepEqual(resolveAppearance({theme:'bad',view:'bad'},true),{theme:'light',resolvedTheme:'light',view:'standard'});
  const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
  assert.deepEqual(readAppearance(blocked,undefined,undefined),{theme:'system',view:'standard'});
  assert.doesNotThrow(()=>saveAppearance(blocked,undefined,undefined,{theme:'dark',view:'concise'}));
});

test('损坏的持久化配置回退浅色和正常视图', () => {
  assert.deepEqual(readAppearance({getItem:()=>'{bad'}, 'origin', 'u'), {theme:'light',view:'standard'});
});

test('两套主题中的正文与次要文字在主要背景上可读', async () => {
  const fs = await import('node:fs'); const postcss = (await import('postcss')).default;
  const css = postcss.parse(fs.readFileSync(new URL('./appearance.css', import.meta.url), 'utf8'));
  const contrast = (a,b) => { const l = x => {const c=x.slice(1).match(/.{2}/g).map(n=>parseInt(n,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];}; const x=l(a),y=l(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  for (const selector of [':root, html[data-theme="light"]','html[data-theme="dark"]']) {
    const values={}; css.walkRules(rule=>{if(rule.selector===selector)rule.walkDecls(d=>{values[d.prop]=d.value;});});
    for (const fg of ['--text-1','--text-2','--text-3']) for(const bg of ['--surface-0','--surface-1','--surface-2']) assert.ok(contrast(values[fg],values[bg])>=4.5,`${selector}: ${fg} / ${bg}`);
  }
});

test('首帧脚本读取非敏感显示缓存并同步主题颜色', async () => {
  const fs=await import('node:fs'); const vm=await import('node:vm');
  const code=fs.readFileSync(new URL('../public/appearance-boot.js',import.meta.url),'utf8');
  const meta={setAttribute(k,v){this[k]=v}}, root={dataset:{}};
  const context={document:{documentElement:root,querySelector:()=>meta},localStorage:{getItem:()=>JSON.stringify({theme:'dark',view:'concise'})},matchMedia:()=>({matches:false})};
  vm.runInNewContext(code,context);
  assert.equal(root.dataset.theme,'dark'); assert.equal(root.dataset.view,'concise'); assert.equal(root.dataset.themeFix,''); assert.equal(meta.content,'#0d1110');
});

test('显示设置快捷键不会与输入法和其他弹窗冲突', async () => {
  const {shortcutAction}=await import('./commands.ts');
  assert.equal(shortcutAction({key:'D',ctrlKey:true,shiftKey:true},false),'appearance');
  assert.equal(shortcutAction({key:'d',metaKey:true,shiftKey:true},true),null);
  assert.equal(shortcutAction({key:'D',ctrlKey:true,shiftKey:true,isComposing:true},false),null);
});

test('侧栏默认随视图收放，显式选择优先且按账号隔离', async () => {
  const {railKey,readRail,saveRail,resolveRail}=await import('./appearance.ts');
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  assert.equal(resolveRail(null,'concise'),true);assert.equal(resolveRail(null,'standard'),false);
  saveRail(storage,'https://host','a',false);assert.equal(readRail(storage,'https://host','a'),false);assert.equal(resolveRail(readRail(storage,'https://host','a'),'concise'),false);
  assert.equal(readRail(storage,'https://host','b'),null);assert.notEqual(railKey('https://host','a'),railKey('https://host','b'));
});

test('浅色画布为纯白，主要按钮在两套主题中使用黑白反转', async () => {
  const fs = await import('node:fs'); const postcss = (await import('postcss')).default;
  const css = postcss.parse(fs.readFileSync(new URL('./appearance.css', import.meta.url), 'utf8'));
  const values = selector => { const result = {}; css.walkRules(rule => { if (rule.selector === selector) rule.walkDecls(d => { result[d.prop] = d.value; }); }); return result; };
  const light = values(':root, html[data-theme="light"]'), dark = values('html[data-theme="dark"]');
  assert.equal(light['--surface-0'], '#ffffff');
  assert.equal(light['--primary-bg'], '#000000'); assert.equal(light['--primary-text'], '#ffffff');
  assert.equal(dark['--primary-bg'], '#ffffff'); assert.equal(dark['--primary-text'], '#000000');
});
