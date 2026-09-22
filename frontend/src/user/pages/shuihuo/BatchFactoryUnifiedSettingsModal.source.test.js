import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(directory, 'BatchFactoryUnifiedSettingsModal.jsx');

test('unified configuration owns models, AI reasoning and publication in one editable patch', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(source, /模型配置/);
  assert.match(source, /AI 推理/);
  assert.match(source, /发布统一/);
  assert.match(source, /BatchFactoryEngineSettingsForm/);
  assert.match(source, /BatchFactoryAiReasoningForm/);
  assert.match(source, /onSaved\(\{ patch: draftPatch/);
});

test('unified configuration makes an unavailable model directory actionable instead of rendering empty selectors', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(source, /const \[modelsError, setModelsError\] = useState\(''\)/);
  assert.match(source, /setModelsError\(error\?\.message \|\| '未能读取个人中心已启用模型'\)/);
  assert.match(source, /message="模型目录暂不可用"/);
  assert.match(source, /前往个人中心配置模型/);
});

test('unified configuration loads every typed model without passing Array map indexes as request functions', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(source, /listAvailableModels\('text'\)/);
  assert.match(source, /listAvailableModels\('image'\)/);
  assert.match(source, /listAvailableModels\('video'\)/);
  assert.doesNotMatch(source, /\.map\(listAvailableModels\)/);
});

test('automation preset manager changes the unified draft only after confirmation', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(source, /自动化预设/);
  assert.match(source, /保存为新预设/);
  assert.match(source, /重命名所选预设/);
  assert.match(source, /删除所选预设/);
  assert.match(source, /确认载入此预设/);
  assert.match(source, /setDraftPatch\(clonePresetConfig/);
  assert.doesNotMatch(source, /setDraftPatch\(.*saveBatchSettings/);
});
