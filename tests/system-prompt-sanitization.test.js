const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveSystemPresetBody, sanitizeResolvedPromptBody } = require('../lib/system-preset-catalog');

test('removes standalone separators and the legacy hardcoded base line', () => {
  const result = sanitizeResolvedPromptBody([
    '# 旧提示词',
    '',
    '---',
    '',
    '【基础设定】生成视频不带字幕 | 9:16',
    '',
    '正文规则'
  ].join('\n'));

  assert.equal(result, '# 旧提示词\n\n正文规则');
});

test('neutralizes legacy fixed-duration placeholders before runtime substitution', () => {
  const result = sanitizeResolvedPromptBody('当前单元总时长固定为 {duration}，必须从 00:00 开始并在 {结束时间} 结束。');
  assert.match(result, /当前选择的是 \{duration\} 拆分模式/);
  assert.match(result, /按实际内容确定总时长/);
  assert.match(result, /该分镜标题声明的实际结束时间/);
  assert.doesNotMatch(result, /总时长固定为|\{结束时间\}/);
});

test('sanitizes an already-published legacy base prompt without overwriting user constraint text', () => {
  const store = {
    getPublished(id) {
      return {
        id,
        module: 'script',
        body: '旧规则\n\n---\n\n【基础设定】生成视频不带字幕 | 9:16\n\n新规则'
      };
    },
    listAll() { return []; }
  };

  const result = resolveSystemPresetBody(store, 'script-format-storyboard');
  assert.equal(result, '旧规则\n\n新规则');
  assert.equal(sanitizeResolvedPromptBody('用户自己写：16:9，允许字幕'), '用户自己写：16:9，允许字幕');
});
