import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { imageSettingsFromAccountConfig } = require('../lib/novel-panel/premium-store');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSource = fs.readFileSync(path.join(repoRoot, 'routes', 'novel-panel.js'), 'utf8');

test('reference image generation maps the personal API config image service', () => {
  const settings = imageSettingsFromAccountConfig({
    image: {
      baseUrl: 'https://image.example/v1',
      model: 'image-model',
      apiKey: 'server-only-key'
    }
  });

  assert.equal(settings.base_url, 'https://image.example/v1');
  assert.equal(settings.model, 'image-model');
  assert.equal(settings.api_key, 'server-only-key');
  assert.equal(settings.generate_path, '/images/generations');
});

test('reference image generation does not fall back to the legacy image settings file', () => {
  assert.match(routeSource, /imageSettingsFromAccountConfig\(requestConfig\(req\)\)/);
  assert.doesNotMatch(routeSource, /const settings = premiumStore\(req\)\.readImageSettingsRaw\(req\.username\)/);
  assert.match(routeSource, /个人中心“API 配置”→“生图服务”/);
});
