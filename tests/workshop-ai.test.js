// 改文工作台：独立 AI 客户端测试
const { test } = require('node:test');
const assert = require('node:assert');
const { buildAiPayload, resolveAiSettings, parseAiJsonContent } = require('../lib/novel-fetch-workshop/ai');
const { processConfiguredDocumentText } = require('../lib/novel-fetch-workshop/rules');

test('buildAiPayload 追加 response_format/thinking/extra json', () => {
  const p = buildAiPayload({
    model: 'm1', api_key: 'k', temperature: 0.4, top_p: 0.9, max_tokens: 500,
    json_mode: true, enable_thinking: true, extra_body_json: '{"foo":1}'
  }, { messages: [{ role: 'user', content: 'hi' }], temperature: 0.4 });
  assert.equal(p.model, 'm1');
  assert.deepEqual(p.response_format, { type: 'json_object' });
  assert.deepEqual(p.thinking, { type: 'enabled' });
  assert.equal(p.foo, 1);
  assert.equal(p.max_tokens, 500);
  assert.equal(p.top_p, 0.9);
});

test('buildAiPayload disable_thinking 与 max_tokens 空', () => {
  const p = buildAiPayload({ model: 'm1', api_key: 'k', temperature: 0.2, disable_thinking: true, max_tokens: 0, top_p: 0 }, { messages: [], temperature: 0.2 });
  assert.deepEqual(p.thinking, { type: 'disabled' });
  assert.equal(p.max_tokens, undefined);
  assert.equal(p.top_p, undefined);
});

test('resolveAiSettings 按用途取预设或当前配置', () => {
  const store = {
    getAiConfig: () => ({
      ai: { base_url: 'https://x/v1', api_key: '', model: 'cur', temperature: 0.3 },
      ai_presets: [{ id: 'p1', base_url: 'https://y/v1', api_key: 'k1', model: 'pre' }],
      ai_assignments: { classifier: 'p1', rewrite: '__current__' }
    })
  };
  const cls = resolveAiSettings(store, 'classifier');
  assert.equal(cls.model, 'pre');
  assert.equal(cls.baseUrl, 'https://y/v1');
  assert.equal(cls.apiKey, 'k1');
  const rw = resolveAiSettings(store, 'rewrite');
  assert.equal(rw.model, 'cur');
  assert.equal(rw.baseUrl, 'https://x/v1');
});

test('parseAiJsonContent 剥离代码块与前后缀', () => {
  assert.deepEqual(parseAiJsonContent('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseAiJsonContent('前缀 {"a":1} 后缀'), { a: 1 });
  assert.equal(parseAiJsonContent('纯文本没有json'), null);
});

test('已保存处理配置在原文和 AI 文案按各自开关统一生效', () => {
  const config = {
    layout: { apply_to_original: true, apply_to_ai: false, apply_sensitive: true },
    sensitive: {
      groups: [{
        name: '默认词组',
        enabled: true,
        apply_to_original: true,
        apply_to_ai: false,
        rules: [{ find: '敏感词', replace: '合规词', enabled: true }]
      }]
    },
    knowledge: { layout_rules: { apply_sensitive_replace: true } }
  };

  assert.equal(processConfiguredDocumentText('敏感词', 'original', config), '合规词');
  assert.equal(processConfiguredDocumentText('敏感词', 'ai', config), '敏感词');
});
