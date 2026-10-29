import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';

const files = ['src/styles.css', 'src/readability.css', 'src/accounts.css', 'src/components/model-settings.css', 'src/experience.css', 'src/data-workflow.css', 'src/task-control.css', 'src/commands.css', 'src/report-assets.css', 'src/report-explorer.css', 'src/report-details.css'];
const roots = files.map(file => ({ file, root: postcss.parse(fs.readFileSync(file, 'utf8')) }));
const tokens = {};
for (const { root } of roots) root.walkRules(':root', rule => rule.walkDecls(decl => { tokens[decl.prop] = decl.value; }));
const isPrint = node => { for (let p = node.parent; p; p = p.parent) if (p.type === 'atrule' && p.name === 'media' && p.params.includes('print')) return true; return false; };
function contrast(a, b) {
  const l = hex => { let c = hex.replace('#', ''); if (c.length === 3) c = [...c].map(x => x + x).join(''); const s = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * s[0] + .7152 * s[1] + .0722 * s[2]; };
  const x = l(a), y = l(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
test('muted and faint text meet 4.5:1 on both application surfaces', () => {
  for (const fg of ['--muted', '--faint']) for (const bg of ['--bg', '--paper']) assert.ok(contrast(tokens[fg], tokens[bg]) >= 4.5, `${fg} on ${bg}: ${contrast(tokens[fg], tokens[bg]).toFixed(2)}`);
});
test('screen typography uses tokens without sub-11px information text', () => {
  assert.equal(tokens['--text-xs'], '11px'); assert.equal(tokens['--text-base'], '13px');
  for (const { file, root } of roots) root.walkDecls('font-size', decl => {
    if (isPrint(decl)) return;
    assert.doesNotMatch(decl.value, /^\d+(?:\.\d+)?px$/, `${file}: ${decl.parent.selector}`);
    const token = /^var\((--[\w-]+)\)$/.exec(decl.value)?.[1];
    if (token && /^\d+(?:\.\d+)?px$/.test(tokens[token] || '')) assert.ok(parseFloat(tokens[token]) >= 11, `${file}: ${decl.parent.selector}`);
  });
});
