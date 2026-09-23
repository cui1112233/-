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

test('opens a per-shot editor with the shared image-aware @ asset menu', () => {
  assert.match(page, /<InlineMentionEditor[\s\S]*ariaLabel="分镜提示词编辑"/);
  assert.match(page, /target=\{shotMention\}/);
  assert.match(page, /shotEditorRef\.current\?\.replaceTarget\(shotMention, asset\)/);
});

test('offers entity mentions while editing the complete script output', () => {
  assert.match(page, /const \[outputMention, setOutputMention\] = useState\(null\);/);
  assert.match(page, /<InlineMentionEditor[\s\S]*ariaLabel="完整剧本编辑"/);
  assert.match(page, /ref=\{outputEditorRef\}/);
  assert.match(page, /target=\{outputMention\}/);
  assert.match(page, /outputEditorRef\.current\?\.replaceTarget\(outputMention, asset\)/);
  assert.doesNotMatch(page, /outputMentionCandidates\(/);
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
