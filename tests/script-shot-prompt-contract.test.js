const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prompts = path.resolve(__dirname, '..', 'prompts');

test('non-shortdrama prompt contracts require self-contained 分镜 units', () => {
  for (const file of ['画布模式.md', '剧情模式.md', '分镜模式.md']) {
    const content = fs.readFileSync(path.join(prompts, file), 'utf8');
    assert.match(content, /### 分镜/);
    assert.match(content, /总时长：Xs/);
    assert.match(content, /00:00/);
    assert.match(content, /独立/);
    assert.match(content, /禁止使用 `---`/);
  }
  assert.match(fs.readFileSync(path.join(prompts, '约束设置.md'), 'utf8'), /每个完整分镜内部/);
});

test('dynamic duration contract uses actual unit duration instead of fixed 10s or 15s ending', () => {
  const general = fs.readFileSync(path.join(prompts, '通用规则.md'), 'utf8');
  const segmented = fs.readFileSync(path.join(prompts, '分段开头.md'), 'utf8');
  assert.match(general, /10s \/ 15s 是拆分模式/);
  assert.match(general, /空间分界优先级最高/);
  assert.match(general, /8s 分镜结束于 `00:08`/);
  assert.match(segmented, /不得统一写死为 `00:10` 或 `00:15`/);
});

test('shotlist prompt no longer owns a hardcoded video ratio base line', () => {
  const content = fs.readFileSync(path.join(prompts, '分镜模式.md'), 'utf8');
  assert.doesNotMatch(content, /【基础设定】生成视频不带字幕 \| 9:16/);
  assert.match(content, /服务器提供的人物行/);
  assert.match(content, /服务器提供的场景环境行/);
  assert.match(content, /连续、爆款、分段/);
});
