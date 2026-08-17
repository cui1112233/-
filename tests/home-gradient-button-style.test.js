const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'src', 'shared', 'styles', 'home-gradient-button.css'), 'utf8');
const button = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'src', 'shared', 'components', 'GradientButton.jsx'), 'utf8');

test('home gradient buttons retain their visual layers', () => {
  assert.match(button, /gradient-btn__stars-container/);
  assert.match(button, /gradient-btn__glow/);
  assert.match(css, /\.gradient-btn\s*\{/);
  assert.match(css, /\.gradient-btn__stars\s*\{/);
  assert.match(css, /\.gradient-btn__glow\s*\{/);
  assert.match(css, /\.gradient-btn:hover/);
});
