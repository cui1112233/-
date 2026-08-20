// 改文工作台：规则排版管线测试
// 覆盖：段落样式（缩进/空行）、章节整行删除、重复标点压缩、成对补符号、symbol_trim 拆行、
// trace 阶段数与样本结构、AI 生成规则建议（stub ai 返回合法 JSON + 字段白名单校验）。
const { test } = require('node:test');
const assert = require('node:assert');
const {
  processDocumentText,
  processDocumentTrace,
  suggestRulesWithAi,
  normalizeAiRuleSuggestions,
  cleanRuleList,
  loadKnowledgeDefaults,
  DEFAULT_KNOWLEDGE
} = require('../lib/novel-fetch-workshop/rules');

// 基础排版开关（对齐 config.js layout 默认值）
const BASE_LAYOUT = {
  apply_to_original: true,
  apply_to_ai: true,
  apply_sensitive: true,
  apply_chapter_cleanup: true,
  apply_symbol_rules: true,
  apply_pair_fill: true,
  drop_empty_lines: true,
  trim_lines: true
};

// 空章节规则（避免默认种子内置规则干扰测试预期）
function emptyChapterRules() {
  return {
    chapter_cleanup_enabled: true,
    chapter_remove_standalone: true,
    chapter_remove_inline: false,
    chapter_exact_rules: [],
    chapter_inline_rules: [],
    chapter_builtin_exact_rules: [],
    chapter_builtin_inline_rules: []
  };
}

test('段落样式：缩进与段间空行', () => {
  const layout = { ...BASE_LAYOUT, apply_sensitive: false };
  const knowledge = {
    layout_rules: { indent_spaces: 2, blank_lines_before: 1, drop_empty_lines: true, apply_sensitive_replace: false },
    symbol_rules: {},
    chapter_rules: emptyChapterRules()
  };
  const out = processDocumentText('第一段内容\n\n第二段内容', 'original', layout, knowledge);
  assert.equal(out, '  第一段内容\n\n  第二段内容');
});

test('章节清洗：整行删除章节标题', () => {
  const layout = BASE_LAYOUT;
  const knowledge = {
    layout_rules: {},
    symbol_rules: {},
    chapter_rules: {
      ...emptyChapterRules(),
      chapter_exact_rules: [{ find: '^第一章$', replace: '', enabled: true }]
    }
  };
  const out = processDocumentText('第一章\n这是正文内容。', 'original', layout, knowledge);
  assert.ok(!out.includes('第一章'));
  assert.ok(out.includes('这是正文内容。'));
});

test('重复标点压缩', () => {
  const layout = { ...BASE_LAYOUT, apply_sensitive: false };
  const knowledge = {
    layout_rules: {},
    symbol_rules: {},
    chapter_rules: emptyChapterRules()
  };
  const out = processDocumentText('真的吗？？！！', 'original', layout, knowledge);
  assert.equal(out, '真的吗？！');
});

test('成对补符号：缺失右引号补全', () => {
  const layout = BASE_LAYOUT;
  const knowledge = {
    layout_rules: {},
    symbol_rules: { pair_fill_rules: [{ find: '“', replace: '”', enabled: true }] },
    chapter_rules: emptyChapterRules()
  };
  const out = processDocumentText('他说“你好。', 'original', layout, knowledge);
  assert.equal(out, '他说“你好。”');
});

test('symbol_trim：按字位拆行', () => {
  const layout = BASE_LAYOUT;
  const knowledge = {
    layout_rules: {},
    symbol_rules: {
      enable_symbol_trim: true,
      symbol_trim_positions: '3',
      symbol_trim_allow_adjacent: false,
      symbol_rules: [{ find: '，', replace: '', enabled: true }],
      pair_fill_rules: []
    },
    chapter_rules: emptyChapterRules()
  };
  const out = processDocumentText('第一，二行', 'original', layout, knowledge);
  assert.ok(out.includes('\n'));
  assert.ok(out.includes('第一，'));
  assert.ok(out.includes('二行'));
});

test('processDocumentTrace：阶段数与样本结构', () => {
  const layout = { ...BASE_LAYOUT, sensitiveKeywords: [{ find: '艹', replace: '草' }] };
  const knowledge = {
    layout_rules: { indent_spaces: 2, blank_lines_before: 0, apply_sensitive_replace: true },
    symbol_rules: {
      enable_symbol_trim: true,
      symbol_trim_positions: '3',
      symbol_trim_allow_adjacent: false,
      symbol_rules: [{ find: '，', replace: '', enabled: true }],
      pair_fill_rules: [{ find: '“', replace: '”', enabled: true }]
    },
    chapter_rules: {
      ...emptyChapterRules(),
      chapter_exact_rules: [{ find: '^第一章$', replace: '', enabled: true }]
    }
  };
  const stages = processDocumentTrace('第一章\n他说艹。她问“真的吗', 'original', layout, knowledge);

  // raw + sensitive + chapter_1 + punctuation_1 + symbol_trim + pair_fill + punctuation_2 + chapter_2 + paragraph
  assert.equal(stages.length, 9);
  assert.equal(stages[0].stage, 'raw');
  assert.equal(stages[1].stage, 'sensitive');
  assert.equal(stages[stages.length - 1].stage, 'paragraph');
  assert.equal(stages[1].changed, true);

  for (const stage of stages) {
    assert.ok(stage.stage);
    assert.ok(stage.title);
    assert.equal(typeof stage.chars, 'number');
    assert.equal(typeof stage.lines, 'number');
    assert.equal(typeof stage.changed, 'boolean');
    assert.ok(Array.isArray(stage.samples));
    assert.ok(stage.samples.length <= 8);
    for (const sample of stage.samples) {
      assert.ok(Object.hasOwn(sample, 'before'));
      assert.ok(Object.hasOwn(sample, 'after'));
    }
  }
});

test('processDocumentText：scope 开关关闭时跳过排版', () => {
  const layout = { ...BASE_LAYOUT, apply_to_original: false };
  const knowledge = {
    layout_rules: { indent_spaces: 2 },
    symbol_rules: {},
    chapter_rules: emptyChapterRules()
  };
  const out = processDocumentText('第一行\n第二行', 'original', layout, knowledge);
  assert.equal(out, '第一行\n第二行'); // 仅归一化换行
});

test('suggestRulesWithAi：单类 layout_rules 白名单校验', async () => {
  const ai = {
    chatCompletion: async () => ({
      text: JSON.stringify({
        layout_rules: {
          layout_rules: { indent_spaces: 2, blank_lines_before: 1, apply_sensitive_replace: true, evil_field: 'x' },
          layout: { drop_empty_lines: true, trim_lines: true, apply_sensitive: true, apply_chapter_cleanup: true, apply_symbol_rules: true, apply_pair_fill: true, extra: 1 }
        }
      }),
      raw: {}
    })
  };
  const result = await suggestRulesWithAi(ai, '样本文案', { ruleType: 'layout_rules' });
  assert.equal(result.ok, true);
  const layout = result.suggestions.layout_rules;
  assert.equal(layout.layout_rules.indent_spaces, 2);
  assert.equal(layout.layout_rules.blank_lines_before, 1);
  assert.ok(!('evil_field' in layout.layout_rules));
  assert.ok(!('extra' in layout.layout));
});

test('suggestRulesWithAi：缺省生成 6 类建议并白名单校验', async () => {
  const ai = {
    chatCompletion: async () => ({
      text: JSON.stringify({
        sensitive: { rules: [{ find: '艹', replace: '草', enabled: true }], evil: 1 },
        layout_rules: { layout_rules: { indent_spaces: 0 }, layout: { drop_empty_lines: true } },
        chapter_exact_rules: { chapter_exact_rules: [{ find: '^第.*章$', replace: '', enabled: true }], chapter_inline_rules: [], settings: {} },
        chapter_inline_rules: { chapter_exact_rules: [], chapter_inline_rules: [{ find: '^第.*章', replace: '', enabled: true }], settings: {} },
        symbol_rules: { symbol_rules: [{ find: '，', replace: '', enabled: true }], settings: {} },
        pair_fill_rules: { pair_fill_rules: [{ find: '“', replace: '”', enabled: true }] }
      }),
      raw: {}
    })
  };
  const result = await suggestRulesWithAi(ai, '样例');
  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.keys(result.suggestions).sort(),
    ['chapter_exact_rules', 'chapter_inline_rules', 'layout_rules', 'pair_fill_rules', 'sensitive', 'symbol_rules']
  );
  assert.equal(result.suggestions.sensitive.rules[0].find, '艹');
  assert.ok(!('evil' in result.suggestions.sensitive));
  assert.equal(result.suggestions.pair_fill_rules.pair_fill_rules[0].find, '“');
});

test('suggestRulesWithAi：缺少样本文案抛错', async () => {
  const ai = { chatCompletion: async () => ({ text: '{}', raw: {} }) };
  await assert.rejects(() => suggestRulesWithAi(ai, '', {}), /请输入样本文案/);
});

test('suggestRulesWithAi：非法规则类型抛错', async () => {
  const ai = { chatCompletion: async () => ({ text: '{}', raw: {} }) };
  await assert.rejects(() => suggestRulesWithAi(ai, '样例', { ruleType: 'unknown_type' }), /规则类型无效/);
});

test('normalizeAiRuleSuggestions：sensitive 白名单只保留 find/replace/enabled', () => {
  const result = normalizeAiRuleSuggestions('sensitive', {
    rules: [{ find: '甲', replace: '乙', enabled: true, evil: 1 }, { find: '  ', replace: 'x' }, 'bad'],
    extra: '丢弃'
  });
  assert.equal(result.rules.length, 1);
  assert.deepEqual(result.rules[0], { find: '甲', replace: '乙', enabled: true });
});

test('cleanRuleList：空 find 丢弃、非对象丢弃', () => {
  const rules = cleanRuleList([
    { find: '  ', replace: 'x', enabled: true },
    { find: '甲', replace: '乙', enabled: false },
    'not-object'
  ]);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].find, '甲');
  assert.equal(rules[0].enabled, false);
});

test('默认知识库种子可加载', () => {
  const defaults = loadKnowledgeDefaults();
  assert.ok(defaults.layout_rules.indent_spaces !== undefined);
  assert.ok(defaults.layout_rules.apply_sensitive_replace !== undefined);
  assert.ok(Array.isArray(defaults.symbol_rules.symbol_rules) && defaults.symbol_rules.symbol_rules.length > 0);
  assert.ok(Array.isArray(defaults.symbol_rules.pair_fill_rules) && defaults.symbol_rules.pair_fill_rules.length > 0);
  assert.ok(Array.isArray(defaults.chapter_rules.chapter_exact_rules));
  assert.ok(Array.isArray(defaults.chapter_rules.chapter_builtin_exact_rules));
  assert.ok(Array.isArray(defaults.chapter_rules.chapter_builtin_inline_rules));
  assert.equal(DEFAULT_KNOWLEDGE.layout_rules.indent_spaces, 0);
});
