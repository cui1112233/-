import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, 'ScriptPage.jsx'), 'utf8');
const generationApi = fs.readFileSync(path.join(here, '../../shared/api/generation.js'), 'utf8');

test('shows selectable text and image models and sends the selected text model to script generation', () => {
  assert.match(page, /placeholder="文本模型"/);
  assert.match(page, /placeholder="图片模型"/);
  assert.match(page, /\['text', 'image'\].map\(kind => listAvailableModels\(kind\)/);
  assert.match(page, /textModelId:\s*scriptModelSelection\.textModelId/);
  assert.match(generationApi, /\.\.\.\(textModelId \? \{ textModelId \} : \{\}\)/);
});

test('opens a per-shot editor that inserts character and scene @ mentions at the cursor', () => {
  assert.match(page, /function insertShotMention\(name\)/);
  assert.match(page, /function mentionCandidates\(items\)/);
  assert.match(page, /@人物 \{formatEntity\(item\)\}/);
  assert.match(page, /@场景 \{formatEntity\(item\)\}/);
  assert.match(page, /placeholder="输入 @ 选择人物或场景，也可直接输入 @名称"/);
});

test('offers entity mentions while editing the complete script output', () => {
  assert.match(page, /const \[outputMention, setOutputMention\] = useState\(null\);/);
  assert.match(page, /function syncOutputMention\(input, nextOutput\)/);
  assert.match(page, /function insertOutputMention\(name\)/);
  assert.match(page, /ref=\{editingOutputInputRef\}/);
  assert.match(page, /onSelect=\{event => syncOutputMention\(event\.target, output\)\}/);
  assert.match(page, /onClick=\{\(\) => insertOutputMention\(formatEntity\(item\)\)\}/);
});

test('keeps storyboard rendering safe by defining the video permission state it passes to shot cards', () => {
  assert.match(page, /const \[canGenerateVideo, setCanGenerateVideo\] = useState\(false\);/);
  assert.match(page, /getMemberCenter\(\)\.then\(result =>/);
  assert.match(page, /onGenerateVideo=\{canGenerateVideo \? generateVideoForShot : null\}/);
});

test('opens entity editors without invoking the retired image-panel state setters', () => {
  assert.doesNotMatch(page, /setGeneratingImage\(/);
  assert.doesNotMatch(page, /setUploadingImage\(/);
  assert.doesNotMatch(page, /setImageGenerationError\(/);
});
