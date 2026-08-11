const test = require('node:test');
const assert = require('node:assert/strict');

const gate = require('../lib/novel-panel/quality-gate');

function completeResult(overrides = {}) {
  return {
    outline_shots: [
      {
        id: 'shot-1',
        source_lines: [1],
        characters: ['沈星'],
        visible_characters: ['沈星'],
        prompt: '在旧书店的收银台前，沈星把泛黄票据摊开，指尖沿着红章边缘停住，窗外雨光落在纸面上，老板抬头看见她发白的脸色。',
        visual_context: '旧书店｜收银台',
        timeline_segments: [{
          source_lines: [1],
          prompt: '在旧书店的收银台前，沈星把泛黄票据摊开，指尖沿着红章边缘停住，窗外雨光落在纸面上，老板抬头看见她发白的脸色。'
        }]
      },
      {
        id: 'shot-2',
        source_lines: [2],
        characters: ['老板'],
        visible_characters: ['老板'],
        prompt: '柜台后的老板按住账本，镜片反出门口的冷光，他压低声音指向票据背面的签名，沈星顺着他的手势看过去。',
        visual_context: '旧书店｜柜台'
      }
    ],
    ...overrides
  };
}

function completeContext(overrides = {}) {
  return {
    mode: 'outline',
    source_lines: [
      '沈星在旧书店翻出一张带红章的旧票据。',
      '老板指给她看票据背面的签名。'
    ],
    manual_cast_mode: true,
    manual_selected_characters: ['沈星', '老板'],
    manual_forbidden_characters: ['林澈'],
    previous_outline_shots: [
      { id: 'shot-1', prompt: '旧版本画面一' },
      { id: 'shot-2', prompt: '旧版本画面二' }
    ],
    user_guidance: '把动作写得更具体',
    ...overrides
  };
}

function codes(report) {
  return report.blockingIssues.map(issue => issue.code);
}

test('exports the V77 validator and summary APIs without browser globals', () => {
  for (const key of [
    'validateOutlineApplyGate',
    'validateOutlineCoverage',
    'validateShotDisplayability',
    'validateManualCastAuthority',
    'validateRegenerationGuidance',
    'summarizeOutlineGateIssues'
  ]) assert.equal(typeof gate[key], 'function', key);
  assert.equal(typeof globalThis.__outlineQualityGateV77, 'undefined');
});

test('passes a complete outline and preserves the V77 report contract', () => {
  const report = gate.validateOutlineApplyGate(completeResult(), completeContext());
  assert.equal(report.ok, true);
  assert.equal(report.severity, 'pass');
  assert.equal(report.blockingIssues.length, 0);
  assert.equal(report.warnings.length, 0);
  assert.equal(report.blockers, report.blockingIssues);
  assert.equal(report.metrics.shotCount, 2);
  assert.equal(gate.summarizeOutlineGateIssues(report), 'AI结果通过验收。');
});

test('summarizes the first three blocking issues', () => {
  assert.equal(gate.summarizeOutlineGateIssues({
    blockingIssues: [{ message: '原因一' }, { message: '原因二' }, { message: '原因三' }, { message: '原因四' }],
    warnings: []
  }), '原因一；原因二；原因三');
});

test('blocks an empty outline', () => {
  const report = gate.validateOutlineApplyGate({ outline_shots: [] }, completeContext());
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes('outline_shots_empty'));
});

test('blocks missing source line coverage', () => {
  const report = gate.validateOutlineCoverage({ outline_shots: [completeResult().outline_shots[0]] }, completeContext());
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes('outline_missing_source_lines'));
});

test('blocks a prompt copied from the source', () => {
  const report = gate.validateShotDisplayability({ outline_shots: [{
    source_lines: [1],
    prompt: '沈星在旧书店翻出一张带红章的旧票据。',
    source_basis: '沈星在旧书店翻出一张带红章的旧票据。'
  }] }, completeContext({ source_lines: ['沈星在旧书店翻出一张带红章的旧票据。'] }));
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes('shot_prompt_copies_source'));
});

test('blocks protocol text embedded in a prompt', () => {
  const report = gate.validateShotDisplayability({ outline_shots: [{
    source_lines: [1],
    prompt: '每个时段必须严格填写 scenes[].shots[] 字段，prompt 只写画面正文。'
  }] }, completeContext({ source_lines: ['她推门走进店里。'] }));
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes('shot_rule_contamination'));
});

test('permits visible content mentioning JSON errors', () => {
  const report = gate.validateShotDisplayability({ outline_shots: [{
    source_lines: [1],
    source_basis: '屏幕弹出系统消息，提示 JSON 错误。',
    prompt: '昏暗办公室里，电脑屏幕弹出一条系统消息，红色错误框显示 JSON 错误，沈星俯身盯着屏幕，手指停在回车键上，桌面散着打印出的日志纸。'
  }] }, completeContext({ source_lines: ['屏幕弹出系统消息，提示 JSON 错误。'] }));
  assert.equal(report.ok, true);
});

test('blocks unchanged single-scene regeneration', () => {
  const prompt = '在旧书店的收银台前，沈星把泛黄票据摊开。';
  const report = gate.validateRegenerationGuidance({ outline_shots: [{ prompt }] }, completeContext({
    mode: 'scene_regenerate', user_guidance: '加强动作细节', previous_outline_shots: [{ prompt }]
  }));
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes('regenerate_unchanged'));
});

test('blocks manual cast conflicts', () => {
  const report = gate.validateManualCastAuthority({ outline_shots: [{
    characters: ['沈星', '林澈'],
    visible_characters: ['沈星', '林澈'],
    prompt: '沈星站在旧书店门口，林澈从柜台后侧身出现。'
  }] }, completeContext());
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes('manual_cast_forbidden_character'));
  assert.ok(codes(report).includes('manual_cast_missing_character'));
});

test('accepts V77 source and context aliases', () => {
  const report = gate.validateOutlineApplyGate({ outline_shots: [
    { source_index: 0, source_basis: '沈星推开旧书店的门。', prompt: '旧书店门口的铜铃轻晃，沈星推门进入，雨水从伞尖滴到木地板上，她抬头看向柜台后的老板。' },
    { source_index: 1, source_basis: '老板把旧票据递给她。', prompt: '柜台后的老板从账本夹层抽出旧票据，纸边擦过台灯光圈，他把票据推到沈星手边。' }
  ] }, { novelText: '沈星推开旧书店的门。\n老板把旧票据递给她。' });
  assert.equal(report.ok, true);
  assert.equal(report.metrics.coveredSourceLineCount, 2);
});

test('uses index fallback when shot and source counts agree', () => {
  const report = gate.validateOutlineCoverage({ outline_shots: [
    { prompt: '雨夜的旧书店门口，沈星收起湿伞，铜铃随着门缝晃动，她停在柜台前看向灯下账本。' },
    { prompt: '老板翻开账本夹层，指腹压住泛黄票据边缘，把红章一侧推到沈星面前。' }
  ] }, { sourceText: '沈星推开旧书店的门。\n老板把旧票据递给她。' });
  assert.equal(report.ok, true);
  assert.equal(report.metrics.usedIndexFallback, true);
});

test('does not let short source_basis cover multiple lines', () => {
  const report = gate.validateOutlineCoverage({ outline_shots: [{
    source_basis: '沈星', prompt: '旧书店门口，沈星收起湿伞，站在门边看向柜台深处的昏黄台灯。'
  }] }, { novelText: '沈星推开旧书店的门。\n沈星看见柜台后的旧票据。\n沈星听见老板压低声音提醒。' });
  assert.equal(report.ok, false);
  assert.equal(report.metrics.coveredSourceLineCount, 0);
  assert.ok(codes(report).includes('outline_missing_source_lines'));
});

test('does not map a negative source_index to the first line', () => {
  const report = gate.validateOutlineCoverage({ outline_shots: [{
    source_index: -1, prompt: '旧书店门口，沈星收起湿伞，铜铃随着门缝轻轻晃动。'
  }] }, { novelText: '沈星推开旧书店的门。' });
  assert.equal(report.ok, false);
  assert.equal(report.metrics.coveredSourceLineCount, 0);
  assert.ok(codes(report).includes('outline_missing_source_lines'));
});

test('blocks unchanged regeneration through planned aliases', () => {
  const prompt = '沈星站在柜台前，低头看着票据上的红章。';
  const report = gate.validateRegenerationGuidance({ outline_shots: [{ prompt }] }, {
    guidance: '增加手部动作', beforeShots: [{ prompt }]
  });
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes('regenerate_unchanged'));
});

test('manual mode forbids unselected formal characters', () => {
  const report = gate.validateManualCastAuthority({ outline_shots: [{
    characters: ['沈星', '林澈'], prompt: '沈星看着票据，林澈站在她身后伸手挡住门口光线。'
  }] }, { scene: { characters_mode: 'manual', characters: ['沈星'] }, allCharacterNames: ['沈星', '林澈', '老板'] });
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes('manual_cast_forbidden_character'));
});

test('blocks clearly generic prompts', () => {
  const report = gate.validateShotDisplayability({ outline_shots: [{ source_lines: [1], prompt: '人物动作清楚呈现。' }] }, {
    source_lines: ['沈星推开旧书店的门。']
  });
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes('shot_prompt_too_generic'));
});

test('CommonJS module cache preserves the same export without a browser load guard', () => {
  const modulePath = require.resolve('../lib/novel-panel/quality-gate');
  assert.equal(require(modulePath), gate);
});

test('weak candidates are blocked without mutating the candidate or context', () => {
  const candidate = { outline_shots: [{ source_lines: [1], prompt: '画面展示。' }] };
  const context = { source_lines: ['甲推门。', '乙回头。'] };
  const beforeCandidate = structuredClone(candidate);
  const beforeContext = structuredClone(context);
  const report = gate.validateOutlineApplyGate(candidate, context);
  assert.equal(report.ok, false);
  assert.ok(report.blockers.length > 0);
  assert.deepEqual(candidate, beforeCandidate);
  assert.deepEqual(context, beforeContext);
});
