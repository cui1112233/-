import test from 'node:test';
import assert from 'node:assert/strict';

import { audioBlobToDataUrl, narrationFilename, resolveNarrationSettings, resolveSpeakerVoiceAsset } from '../frontend/src/user/pages/shuihuo/directNarration.js';
import fs from 'node:fs';

const workbench = fs.readFileSync(new URL('../frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx', import.meta.url), 'utf8');
const row = fs.readFileSync(new URL('../frontend/src/user/pages/shuihuo/StoryboardRow.jsx', import.meta.url), 'utf8');
const productionStyles = fs.readFileSync(new URL('../frontend/src/user/pages/shuihuo-production.css', import.meta.url), 'utf8');

test('direct narration converts an existing TTS audio blob into a persisted-media upload payload', async () => {
  const dataUrl = await audioBlobToDataUrl(new Blob(['voice-bytes'], { type: 'audio/mpeg' }));

  assert.equal(dataUrl, 'data:audio/mpeg;base64,dm9pY2UtYnl0ZXM=');
});

test('each narration upload has a distinct persisted-media filename instead of overwriting a previous take', () => {
  assert.equal(narrationFilename(7, 'take-a'), 'segment-7-narration-take-a.mp3');
  assert.equal(narrationFilename(7, 'take-b'), 'segment-7-narration-take-b.mp3');
});

test('direct narration uses a selected compatible voice asset and keeps per-storyboard speed and pitch', () => {
  assert.deepEqual(resolveNarrationSettings({
    voiceAsset: { prompt: 'zh-CN-YunxiNeural' },
    settings: { speechRate: 1.3, pitch: -4 },
    defaults: { voice: 'zh-CN-XiaoxiaoNeural', style: 'general' }
  }), {
    voice: 'zh-CN-YunxiNeural',
    speed: 1.3,
    pitch: -4,
    style: 'general'
  });
});

test('direct narration falls back to the saved TTS default when an old voice asset only contains a description', () => {
  assert.equal(resolveNarrationSettings({
    voiceAsset: { prompt: '成熟稳重的男声' },
    settings: { speechRate: 1, pitch: 0 },
    defaults: { voice: 'zh-CN-XiaoxiaoNeural', style: 'sad' }
  }).voice, 'zh-CN-XiaoxiaoNeural');
});

test('direct narration resolves a character speaker to the voice bound in that character preset', () => {
  const assets = [
    { id: 4, category: 'character', name: '我', voiceAssetId: 12 },
    { id: 12, category: 'voice', name: '清朗女声', prompt: 'zh-CN-XiaochenNeural' },
    { id: 13, category: 'voice', name: '旁白', prompt: 'zh-CN-XiaoxiaoNeural' }
  ];

  assert.deepEqual(resolveSpeakerVoiceAsset({ speaker: '我', assets, narratorVoiceAssetId: 13 }), assets[1]);
  assert.deepEqual(resolveSpeakerVoiceAsset({ speaker: '旁白', assets, narratorVoiceAssetId: 13 }), assets[2]);
  assert.equal(resolveSpeakerVoiceAsset({ speaker: '不存在的角色', assets, narratorVoiceAssetId: 13 }), undefined);
});

test('workbench bypasses Redis audio tasks and persists direct TTS output for rows and batch narration', () => {
  assert.match(workbench, /textToSpeech\(\{ input, \.\.\.settings \}\)/);
  assert.match(workbench, /audioBlobToDataUrl\(blob\)/);
  assert.match(workbench, /uploadMedia\(project\.id, \{ kind: 'audio'/);
  assert.match(workbench, /key === 'audio' \? generateNarrations/);
  assert.doesNotMatch(workbench, /audioAvailability/);
  assert.match(row, /onGenerateNarration\(segment\)/);
  assert.doesNotMatch(row, /onTask\('audio', segment\.id\)/);
});

test('speaker selector has a stable usable width and does not collapse its options', () => {
  assert.match(productionStyles, /\.shuihuo-voice-script\s*\{[^}]*grid-template-columns:\s*minmax\(104px,\s*132px\)\s+minmax\(0,\s*1fr\)\s+18px/s);
  assert.match(productionStyles, /\.shuihuo-voice-script\s+\.ant-select\s*\{[^}]*width:\s*100%[^}]*min-width:\s*104px/s);
});
