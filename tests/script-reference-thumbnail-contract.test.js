import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const componentPath = path.join(repoRoot, 'frontend', 'src', 'user', 'components', 'ShotOutputCards.jsx');
const stylesPath = path.join(repoRoot, 'frontend', 'src', 'shared', 'styles', 'global.css');

test('shot reference cards render each selected reference URL as a thumbnail', () => {
  const source = fs.readFileSync(componentPath, 'utf8');
  assert.match(source, /<img\b/);
  assert.match(source, /src=\{reference\.url\}/);
  assert.match(source, /className="shot-output-card-reference-thumbnail"/);
  assert.match(source, /alt=\{`\$\{reference\.label\}参考图`\}/);
});

test('shot reference thumbnails have bounded styling and disabled-state visibility', () => {
  const styles = fs.readFileSync(stylesPath, 'utf8');
  assert.match(styles, /\.shot-output-card-reference-item/);
  assert.match(styles, /\.shot-output-card-reference-thumbnail/);
  assert.match(styles, /opacity:\s*\.45/);
});
