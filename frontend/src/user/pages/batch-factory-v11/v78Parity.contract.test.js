import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = relative => fs.readFileSync(path.join(here, relative), 'utf8');

const entry = read('../BatchFactoryPage.jsx');
const uiPage = read('./BatchFactoryV11UiPage.jsx');
const workbench = read('./BatchFactoryV11Workbench.jsx');
const settings = read('./BatchFactoryV11SettingsDrawers.jsx');
const external = read('./ExternalPublishPanel.jsx');

function assertNoSecretSurface(source, label) {
  const forbidden = ['AUTODL_TOKEN', 'apiKey:', 'authorization:', 'Bearer ${', 'minimax_h3_lightx2v_no_pic', 'minimax_h3_lightx2v_v5_15s'];
  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `${label} exposes internal/secret token ${token}`);
  }
}

test('live Batch Factory entry stays on authoritative V11 instead of the stale static preview', () => {
  assert.match(entry, /BatchFactoryV11UiPage/);
  assert.doesNotMatch(entry, /BatchFactoryPreviewPage/);
});

test('V11 unavailable state keeps the V78 production flow visible in a degraded shell', () => {
  assert.match(uiPage, /BatchFactoryUnavailableShell/);
  const shell = read('./BatchFactoryUnavailableShell.jsx');
  assert.match(shell, /多本批量剧本生成/);
  assert.match(shell, /VIDEO 画面提示词/);
  assert.match(shell, /视频模型/);
  assert.match(shell, /上传 121/);
  assert.match(shell, /重新连接/);
  assertNoSecretSurface(shell, 'unavailable shell');
});

test('normal V11 workbench preserves V78 batch flow and names H3 correctly', () => {
  assert.match(workbench, /批量剧本生成/);
  assert.match(workbench, /画面提示词/);
  assert.match(workbench, /autodl_comfyui/);
  assert.match(workbench, /MiniMax H3/);
  assert.match(workbench, /上传 121/);
  assertNoSecretSurface(workbench, 'workbench');
});

test('video model selection remains server-catalog based and 121 remains the default publish target', () => {
  assert.match(settings, /视频模型/);
  assert.match(settings, /MiniMax H3/);
  assert.match(settings, /videoModels/);
  assert.match(external, /value: '121'/);
  assert.match(external, /useState\('121'\)/);
  assertNoSecretSurface(settings, 'settings drawer');
  assertNoSecretSurface(external, 'external publish panel');
});
