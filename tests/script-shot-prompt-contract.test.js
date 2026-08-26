const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prompts = path.resolve(__dirname, '..', 'prompts');
const readPrompt = file => fs.readFileSync(path.join(prompts, file), 'utf8');

test('non-shortdrama prompt contracts require self-contained 分镜 units', () => {
  for (const file of ['画布模式.md', '剧情模式.md', '分镜模式.md']) {
    const content = readPrompt(file);
    assert.match(content, /### 分镜/);
    assert.match(content, /总时长：Xs/);
    assert.match(content, /00:00/);
    assert.match(content, /独立/);
    assert.match(content, /禁止使用 `---`/);
  }
  assert.match(readPrompt('约束设置.md'), /每个完整分镜内部/);
});

test('generation prompts do not use standalone --- separators', () => {
  for (const file of ['通用规则.md', '连续开头.md', '爆款开头.md', '分段开头.md', '画布模式.md', '剧情模式.md', '分镜模式.md', '剧本模式.md', '约束设置.md']) {
    assert.doesNotMatch(readPrompt(file), /^---\s*$/m, `${file} should not contain a standalone --- separator`);
  }
});

test('dynamic duration contract uses actual unit duration instead of fixed 10s or 15s ending', () => {
  const general = readPrompt('通用规则.md');
  const segmented = readPrompt('分段开头.md');
  assert.match(general, /10s \/ 15s 是拆分模式/);
  assert.match(general, /空间分界优先级最高/);
  assert.match(general, /8s 分镜结束于 `00:08`/);
  assert.match(segmented, /不得统一写死为 `00:10` 或 `00:15`/);
});

test('hook mode treats scene counts as soft economy guidance and supports both durations', () => {
  const hook = readPrompt('爆款开头.md');
  assert.match(hook, /倾向约束，不是硬配额/);
  assert.match(hook, /10s 模式通常优先在 1 个主空间/);
  assert.match(hook, /15s 模式通常尽量控制在 1 至 2 个主空间/);
  assert.match(hook, /原文真实空间切换永远优先/);
  assert.match(hook, /画布模式、剧情模式、分镜模式和剧本模式/);
  assert.doesNotMatch(hook, /30s|45-60s|不允许超配额/);
});

test('emotion amplification allows human-like action without inventing key plot facts', () => {
  const general = readPrompt('通用规则.md');
  const hook = readPrompt('爆款开头.md');
  assert.match(general, /允许为了视频表现，把原文已经存在的情绪转化为更像真人的明显动作/);
  assert.match(general, /不得改变剧情事实/);
  assert.match(hook, /允许增加不改变剧情事实的表演动作/);
  assert.match(hook, /不允许通过表演动作创造新的关键因果/);
});

test('shotlist prompt no longer owns a hardcoded video ratio base line', () => {
  const content = readPrompt('分镜模式.md');
  assert.doesNotMatch(content, /【基础设定】生成视频不带字幕 \| 9:16/);
  assert.match(content, /服务器提供的人物行/);
  assert.match(content, /服务器提供的场景环境行/);
  assert.match(content, /连续、爆款、分段/);
});
