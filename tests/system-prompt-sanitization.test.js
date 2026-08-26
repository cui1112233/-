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
