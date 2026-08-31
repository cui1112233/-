import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(name) {
  return fs.readFileSync(path.join(here, name), 'utf8');
}

test('ChangeImpactNotice renders normalized server counts without deriving compatibility locally', () => {
  const source = read('ChangeImpactNotice.jsx');
  assert.match(source, /changeImpactView/);
  assert.match(source, /affectedBooks/);
  assert.match(source, /affectedVideos/);
  assert.match(source, /orphanedOverrides/);
  assert.match(source, /incompatibleOverrides/);
  assert.match(source, /无法读取影响/);
  assert.match(source, /前端不会生成本地替代结果/);
  assert.equal(source.includes('compatibility.filter'), false);
  assert.equal(source.includes('compatibility.length'), false);
  assert.equal(source.includes('batchFactoryV11'), false);
  assert.equal(source.includes('apiRequest'), false);
});

test('ProductionSettingsDrawer uses server change-impact preview instead of local impact inference', () => {
  const source = read('BatchFactoryV11SettingsDrawers.jsx');
  assert.match(source, /ChangeImpactNotice/);
  assert.match(source, /onPreviewChangeImpact/);
  assert.equal(source.includes('const impactfulChange'), false);
  assert.equal(source.includes('const modeChanged'), false);
  assert.equal(source.includes('const modelChanged'), false);
  assert.equal(source.includes('const configChanged'), false);
  assert.equal(source.includes('batchFactoryV11'), false);
  assert.equal(source.includes('apiRequest'), false);
});

test('BatchFactoryV11UiPage passes runtime change-impact preview into the drawer', () => {
  const source = read('BatchFactoryV11UiPage.jsx');
  assert.match(source, /runtime\.previewChangeImpact/);
  assert.match(source, /onPreviewChangeImpact/);
  assert.equal(source.includes('getChangeImpact('), false);
});
