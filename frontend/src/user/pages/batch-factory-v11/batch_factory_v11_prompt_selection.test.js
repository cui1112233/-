import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'src/user/pages/batch-factory-v11');
const settings = fs.readFileSync(path.join(root, 'BatchFactoryV11SettingsDrawers.jsx'), 'utf8');
const api = fs.readFileSync(path.resolve(process.cwd(), 'src/shared/api/batchFactoryV11.js'), 'utf8');

test('V11 production settings exposes backend-driven prompt selectors', () => {
  assert.match(settings, /promptSelections/);
  for (const label of ['Hook 提示词', 'Director 提示词', '画面提示词', '视频提示词', '音频匹配提示词', 'Shot 合成提示词', '成片合成提示词']) {
    assert.match(settings, new RegExp(label));
  }
  assert.match(api, /listPrompts/);
});
