const assert = require('node:assert/strict');
const test = require('node:test');

const { compileVideoPrompt } = require('../lib/batch-factory/video-prompt-compiler');

function fixtureSettings(extra = {}) {
  return {
    aspectRatio: '9:16',
    prefixMode: 'manual',
    customPrefix: '3D国漫',
    quality: '电影级灯光',
    restriction: '禁止字幕',
    negative: '畸形手指',
    injectCharacterPrompt: true,
    injectScenePrompt: true,
    injectPropPrompt: true,
    constraintPrefixEnabled: true,
    constraintQualityEnabled: true,
    constraintRestrictionEnabled: true,
    constraintNegativeEnabled: true,
    ...extra
  };
}

const directorResult = {
  characters: [{ name: '姜晚', prompt: '黑发青年女性，深色风衣' }],
  scenes: [{ name: '总裁办公室', prompt: '夜晚，高层落地窗办公室' }],
  props: [{ name: '文件袋', prompt: '牛皮纸文件袋' }]
};

const video = {
  id: '01',
  duration_sec: 10,
  characters: ['姜晚'],
  scene: '总裁办公室',
  props: ['文件袋'],
  visualPrompt: '姜晚把文件袋重重放在桌面，抬眼直视对方。',
  shots: [{ start_sec: 0, end_sec: 10, description: '文件袋落桌后人物抬眼。' }]
};

test('compiled prompt includes every enabled production constraint', () => {
  const result = compileVideoPrompt({ directorResult, video, settings: fixtureSettings() });
  assert.match(result.prompt, /【整体画面前缀】\n3D国漫/);
  assert.match(result.prompt, /【画质要求】\n电影级灯光/);
  assert.match(result.prompt, /【画面限制】\n禁止字幕/);
  assert.match(result.prompt, /【负面提示词】\n畸形手指/);
  assert.match(result.prompt, /【人物一致性】/);
  assert.match(result.prompt, /【场景一致性】/);
});

test('disabled switches remove their sections from the provider prompt', () => {
  const result = compileVideoPrompt({
    directorResult,
    video,
    settings: fixtureSettings({
      constraintPrefixEnabled: false,
      constraintQualityEnabled: false,
      constraintRestrictionEnabled: false,
      constraintNegativeEnabled: false
    })
  });
  assert.doesNotMatch(result.prompt, /【整体画面前缀】/);
  assert.doesNotMatch(result.prompt, /【画质要求】/);
  assert.doesNotMatch(result.prompt, /【画面限制】/);
  assert.doesNotMatch(result.prompt, /【负面提示词】/);
  assert.match(result.prompt, /【当前VIDEO剧情】/);
});
