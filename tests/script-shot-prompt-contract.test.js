const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prompts = path.resolve(__dirname, '..', 'prompts');

test('non-shortdrama prompt contracts require self-contained 分镜 units', () => {
  for (const file of ['画布模式.md', '剧情模式.md', '分镜模式.md']) {
    const content = fs.readFileSync(path.join(prompts, file), 'utf8');
    assert.match(content, /### 分镜/);
    assert.match(content, /00:00/);
    assert.match(content, /独立/);
  }
  assert.match(fs.readFileSync(path.join(prompts, '约束设置.md'), 'utf8'), /每个分镜内部/);
});

test('分镜模式要求服务器固定头部逐字出现在每个单元中', () => {
  const content = fs.readFileSync(path.join(prompts, '分镜模式.md'), 'utf8');
  assert.match(content, /【基础设定】生成视频不带字幕 \| 9:16/);
  assert.match(content, /服务器提供/);
  assert.doesNotMatch(content, /\{服务器提供/);
  assert.match(content, /不得输出.*JSON|JSON.*不得输出/);
  assert.match(content, /花括号/);
  assert.match(content, /逐字保留/);
  assert.match(content, /连续.*爆款.*分段/);
});
