const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'shared', 'styles', 'global.css'), 'utf8');

function cssBlock(selector) {
  const start = css.indexOf(selector);
  const end = css.indexOf('}', start);
  return start === -1 || end === -1 ? '' : css.slice(start, end + 1);
}

test('user content container remains vertically scrollable for the member page', () => {
  const content = cssBlock('.legacy-content');
  assert.match(content, /overflow-y:\s*auto/);
  assert.doesNotMatch(content, /overflow:\s*hidden/);
});

test('member identity has tier-colored flowing effects with reduced-motion fallback', () => {
  assert.match(css, /@keyframes\s+member-identity-glow/);
  assert.match(css, /@keyframes\s+member-avatar-flow/);
  assert.match(css, /\.member-zone-identity strong\s*\{[\s\S]*?animation:\s*member-identity-glow/);
  assert.match(css, /\.member-zone-avatar::before\s*\{[\s\S]*?animation:\s*member-avatar-flow/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.member-zone-identity \*,[\s\S]*?animation:\s*none/);
});

test('brand logo has a surface sheen and title has continuous color flow', () => {
  assert.match(css, /@keyframes\s+brand-logo-sheen/);
  assert.match(css, /@keyframes\s+brand-title-shift/);
  assert.match(css, /\.legacy-brand-logo::after\s*\{[\s\S]*?pointer-events:\s*none[\s\S]*?animation:\s*brand-logo-sheen/);
  assert.match(css, /\.legacy-brand-title\s*\{[\s\S]*?background-clip:\s*text[\s\S]*?animation:\s*brand-title-shift/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.legacy-brand-logo::after,[\s\S]*?\.legacy-brand-title\s*\{[\s\S]*?animation:\s*none/);
});
