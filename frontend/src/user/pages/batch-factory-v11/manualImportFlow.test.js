import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.join(here, file), 'utf8');

test('formal V11 source manager exposes usable direct import and skill preview controls', () => {
  const source = read('BatchFactoryV11BatchManager.jsx');
  for (const marker of [
    '直接导入内容',
    '执行技能并预览',
    '确认导入并创建 V11 批次',
    'type="file"',
    'accept=".txt,.md,text/plain,text/markdown"',
    'onPreviewManualSkillProcessing',
    'onCreateManualIntake',
    'normalizeSkillIds'
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(source.includes('const HISTORY ='), false);
  assert.equal(source.includes('disabled>加入文案'), false);
});

test('V11 page wires the real direct import manager and reloads the resulting intake', () => {
  const source = read('BatchFactoryV11UiPage.jsx');
  assert.match(source, /BatchFactoryV11BatchManager/);
  assert.match(source, /onPreviewManualSkillProcessing/);
  assert.match(source, /onCreateManualIntake/);
  assert.match(source, /intakeId/);
});
