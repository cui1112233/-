import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = path.join(repoRoot, 'frontend', 'src', 'user', 'pages', 'ApiConfigPage.jsx');

test('text models use the unified catalog save action without inheriting video-only requirements', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.match(source, /\{ key: 'text', title: '文本模型'/);
  assert.match(source, /async function submitCustom\(\)/);
  assert.match(source, /const values = await customForm\.validateFields\(\)/);
  assert.match(source, /kind: 'text'/);
  assert.match(source, /createManagedModel\(payload\)/);
});

test('optional image fields do not block the shared API configuration form', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.doesNotMatch(source, /name=\{\['image', 'model'\]\} rules=\{\[\{ required: true/);
  assert.doesNotMatch(source, /name=\{\['image', 'baseUrl'\]\} rules=\{\[\{ required: true/);
});
