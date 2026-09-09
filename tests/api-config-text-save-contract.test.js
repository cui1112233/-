import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = path.join(repoRoot, 'frontend', 'src', 'user', 'pages', 'ApiConfigPage.jsx');

test('text model has an independent save action with text-only validation', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.match(source, /async function saveText\(\)/);
  assert.match(source, /validateFields\(\['provider', 'baseUrl', 'model'\]\)/);
  assert.match(source, /保存文本模型/);
  assert.match(source, /saveConfig\(\{\s*provider,\s*baseUrl,\s*model/);
});

test('optional image fields do not block the shared API configuration form', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.doesNotMatch(source, /name=\{\['image', 'model'\]\} rules=\{\[\{ required: true/);
  assert.doesNotMatch(source, /name=\{\['image', 'baseUrl'\]\} rules=\{\[\{ required: true/);
});
