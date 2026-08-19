const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prompts = path.resolve(__dirname, '..', 'prompts');
const { SYSTEM_PRESETS } = require('../lib/system-preset-catalog');

test('non-shortdrama prompt contracts require self-contained 分镜 units', () => {
  for (const file of ['画布模式.md', '剧情模式.md', '分镜模式.md']) {
    const content = fs.readFileSync(path.join(prompts, file), 'utf8');
    assert.match(content, /### 分镜/);
    assert.match(content, /00:00/);
    assert.match(content, /独立/);
  }
  assert.match(fs.readFileSync(path.join(prompts, '约束设置.md'), 'utf8'), /每个分镜内部/);
});

test('Q版模式 prompt and catalog contract define the complete shot protocol', () => {
  const content = fs.readFileSync(path.join(prompts, 'Q版模式.md'), 'utf8');
  assert.match(content, /镜头一/);
  assert.match(content, /镜头二/);
  assert.match(content, /10s/);
  assert.match(content, /15s/);
  assert.match(content, /四段式/);
  assert.match(content, /基础设定/);
  assert.match(content, /声音设计/);
  assert.match(content, /氛围与画质规范/);
  assert.match(content, /画面内容/);
  assert.match(content, /---/);
  assert.match(content, /三类画风变体/);
  assert.match(content, /硬性校验/);

  const preset = SYSTEM_PRESETS.find(item => item.id === 'script-format-q版');
  assert.ok(preset);
  assert.equal(preset.module, 'script');
  assert.equal(preset.name, 'Q版模式');
  assert.equal(preset.kind, 'base');
  assert.equal(preset.protocolLock.format, 'q版');
  assert.equal(preset.source, 'Q版模式.md');
});
