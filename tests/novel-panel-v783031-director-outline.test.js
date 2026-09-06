const assert = require('node:assert/strict');
const {
  validateConstraintContract,
  validateConstraintAudit,
  createV783031OutlineHandler,
} = require('../lib/novel-panel/v783031-outline-route');

const contract = {
  must_cover: [{ id: 'M1', requirement: '第一行要拍到奖杯被调包的异常', source_indices: [1], applies_to_all_rows: false, pass_condition: '画面明确看到异常奖杯' }],
  rhythm: [{ id: 'R1', requirement: '第二行结尾停在主角确认反应', source_indices: [2], applies_to_all_rows: false, pass_condition: '最后镜头落在确认反应' }],
  row_guidance: [],
  scene_progression: [{ id: 'S1', requirement: '第二行进入后台监控室', source_indices: [2], applies_to_all_rows: false, pass_condition: '画面真实进入后台监控空间' }],
};
assert.deepEqual(validateConstraintContract(contract, 2), contract);
const bad = JSON.parse(JSON.stringify(contract));
bad.must_cover[0].source_indices = [3];
assert.throws(() => validateConstraintContract(bad, 2), /越界/);
const badBool = JSON.parse(JSON.stringify(contract));
badBool.must_cover[0].applies_to_all_rows = 'false';
assert.throws(() => validateConstraintContract(badBool, 2), /JSON布尔值/);

const firstAudit = {
  must_cover: [{ id: 'M1', passed: true, evidence: [{ source_index: 1, quote: '奖杯底座编号不一致' }], missing: '', failed_source_indices: [] }],
  rhythm: [{ id: 'R1', passed: false, evidence: [], missing: '没有停在确认反应', failed_source_indices: [2] }],
  row_guidance: [],
  scene_progression: [{ id: 'S1', passed: true, evidence: [{ source_index: 2, quote: '后台监控室屏幕冷光' }], missing: '', failed_source_indices: [] }],
  overall_passed: false,
};
assert.equal(validateConstraintAudit(firstAudit, contract, 2).overall_passed, false);

const calls = [];
const remoteJson = async ({ payload }) => {
  calls.push(payload.operation);
  if (payload.operation === 'compile_generic_director_constraint_contract') return contract;
  if (payload.operation === 'generate_outline_with_director_constraint_contract') {
    return { outline_shots: [
      { source_index: 1, source_basis: '奖杯不对劲。', duration: 4, prompt: '舞台近景，奖杯底座编号与名单不一致。' },
      { source_index: 2, source_basis: '她冲到后台看监控。', duration: 5, prompt: '她进入后台监控室查看屏幕。' },
    ] };
  }
  if (payload.operation === 'semantic_audit_director_constraints' && calls.filter(x => x === 'semantic_audit_director_constraints').length === 1) return firstAudit;
  if (payload.operation === 'targeted_repair_failed_director_constraints_once') {
    assert.deepEqual(payload.target_source_indices, [2]);
    assert.equal(payload.existing_shots.length, 1);
    return { outline_shots: [
      { source_index: 2, source_basis: '她冲到后台看监控。', duration: 5, prompt: '后台监控室冷光中，她锁定关键画面后停住，近景落在确认线索的反应。' },
    ] };
  }
  if (payload.operation === 'semantic_audit_director_constraints') {
    return {
      must_cover: [{ id: 'M1', passed: true, evidence: [{ source_index: 1, quote: '异常奖杯' }], missing: '', failed_source_indices: [] }],
      rhythm: [{ id: 'R1', passed: true, evidence: [{ source_index: 2, quote: '停在确认反应' }], missing: '', failed_source_indices: [] }],
      row_guidance: [],
      scene_progression: [{ id: 'S1', passed: true, evidence: [{ source_index: 2, quote: '后台监控室' }], missing: '', failed_source_indices: [] }],
      overall_passed: true,
    };
  }
  throw new Error(`unexpected operation ${payload.operation}`);
};

const handler = createV783031OutlineHandler({ remoteJson, resolveOutlinePreset: () => '旧版分镜系统提示词。', qualityGate: () => ({ ok: true, blockingIssues: [], warnings: [] }) });
const req = {
  username: 'tester',
  body: { novel_text: '奖杯不对劲。\n她冲到后台看监控。', generation_rules: '保持剧情事实。', must_cover_details: '必须拍到奖杯异常。', shot_rhythm_requirements: '第二行最后停在确认反应。', characters: [], outline_shots: [] },
  once() {},
  removeListener() {},
};
let statusCode = 200;
let responseBody;
const res = {
  destroyed: false,
  writableEnded: false,
  statusCode: 200,
  once() {},
  removeListener() {},
  status(code) { statusCode = code; this.statusCode = code; return this; },
  json(value) { responseBody = value; this.writableEnded = true; return value; },
};

(async () => {
  await handler(req, res);
  assert.equal(statusCode, 200);
  assert.equal(responseBody.applied, true);
  assert.equal(responseBody.director_constraint_repair_used, true);
  assert.equal(responseBody.outline_shots.length, 2);
  assert.match(responseBody.outline_shots[1].prompt, /确认线索的反应/);
  assert.equal(responseBody.outline_shots[0].duration, 4);
  assert.equal(responseBody.outline_shots[1].duration, 5);
  assert.deepEqual(calls, [
    'compile_generic_director_constraint_contract',
    'generate_outline_with_director_constraint_contract',
    'semantic_audit_director_constraints',
    'targeted_repair_failed_director_constraints_once',
    'semantic_audit_director_constraints',
  ]);
  assert.match(responseBody.architecture, /targeted_failed_rows_repair_once_if_needed/);
  console.log('V78.3.0.20/21 director semantic outline regression: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
