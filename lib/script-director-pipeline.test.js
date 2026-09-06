'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateGlobalDirectorPlan,
  validateDirectorExecution,
  buildCanonicalSourceRows,
  formatDirectorPipelineOutput
} = require('./script-director-pipeline');

function plan(overrides = {}) {
  return {
    plan_version: 'script_global_director_plan_v1',
    source_units: [
      {
        source_index: 1,
        source_text: '林夏推开病房门。',
        scene_id: 'S1', event_id: 'E1', batch_id: 'B1', duration: 4,
        narrative_function: '进入空间', visual_goal: '建立人物与病房空间关系',
        continuity_in: '走廊门外', continuity_out: '人物已进入病房'
      },
      {
        source_index: 2,
        source_text: '她看见床头压着一封信。',
        scene_id: 'S1', event_id: 'E2', batch_id: 'B1', duration: 6,
        narrative_function: '发现线索', visual_goal: '让信封成为明确可见信息',
        continuity_in: '人物已进入病房', continuity_out: '人物注意到床头信封'
      }
    ],
    ...overrides
  };
}

function execution() {
  return {
    outline_shots: [
      {
        source_index: 1,
        source_basis: '林夏推开病房门。',
        scene_id: 'S1', event_id: 'E1', batch_id: 'B1', duration: 4,
        prompt: '林夏从医院走廊推开病房门进入室内，镜头保持空间方向连续，病房门框与床位形成清晰纵深。',
        timeline_segments: [
          { start_offset: 0, end_offset: 2, duration: 2, shot_size: '中景', angle: '平视', movement: '缓慢跟进', prompt: '林夏从走廊侧推开病房门，门框前景划开空间，人物迈步进入，医院冷白环境光保持自然层次。' },
          { start_offset: 2, end_offset: 4, duration: 2, shot_size: '中近景', angle: '侧前方', movement: '轻微横移', prompt: '镜头随林夏进入病房并让出床位方向，她停步观察室内，动作与上一镜连续，空间轴线不跳变。' }
        ]
      },
      {
        source_index: 2,
        source_basis: '她看见床头压着一封信。',
        scene_id: 'S1', event_id: 'E2', batch_id: 'B1', duration: 6,
        prompt: '林夏的视线从病床移到床头，一封被物件压住的信进入视觉重点，人物反应与线索出现形成清晰因果。',
        timeline_segments: [
          { start_offset: 0, end_offset: 3, duration: 3, shot_size: '近景', angle: '视线侧向', movement: '轻推', prompt: '林夏视线转向床头，镜头沿她的观察方向轻推，让床头区域逐渐成为画面主焦点，同时保留人物反应。' },
          { start_offset: 3, end_offset: 6, duration: 3, shot_size: '特写', angle: '俯视少许', movement: '固定', prompt: '床头被压住的信封清楚进入特写，纸张边缘和压物关系可见，不出现字幕文字，林夏的手停在画外边缘形成将要触碰的动作悬念。' }
        ]
      }
    ]
  };
}

test('global plan must preserve the complete source as exact ordered contiguous units', () => {
  const source = '林夏推开病房门。她看见床头压着一封信。';
  const validated = validateGlobalDirectorPlan(plan(), { novelText: source, maxUnitSeconds: 10 });
  assert.equal(validated.source_units.length, 2);
  assert.equal(validated.source_units.map(item => item.source_text).join(''), source);

  assert.throws(() => validateGlobalDirectorPlan(plan({
    source_units: [{ ...plan().source_units[0], source_text: '林夏进入病房。' }, plan().source_units[1]]
  }), { novelText: source, maxUnitSeconds: 10 }), /原文|覆盖|连续|篡改/);
});

test('matchAudio global plan must close exactly on the real audio duration', () => {
  assert.doesNotThrow(() => validateGlobalDirectorPlan(plan(), {
    novelText: '林夏推开病房门。她看见床头压着一封信。',
    maxUnitSeconds: 10,
    matchAudio: true,
    audioTotalSeconds: 10
  }));

  assert.throws(() => validateGlobalDirectorPlan(plan(), {
    novelText: '林夏推开病房门。她看见床头压着一封信。',
    maxUnitSeconds: 10,
    matchAudio: true,
    audioTotalSeconds: 11
  }), /音频|总时长|11/);
});

test('canonical rows come only from the validated global plan', () => {
  const rows = buildCanonicalSourceRows(plan());
  assert.deepEqual(rows.map(row => [row.source_index, row.source_text]), [
    [1, '林夏推开病房门。'],
    [2, '她看见床头压着一封信。']
  ]);
  assert.match(rows[1].guidance, /发现线索|信封|床头/);
});

test('execution requires exactly one outer shot per plan unit and 1-6 gapless micro shots', () => {
  const validated = validateDirectorExecution(execution(), plan(), { matchAudio: true, audioTotalSeconds: 10 });
  assert.equal(validated.outline_shots.length, 2);

  const gap = execution();
  gap.outline_shots[0].timeline_segments[1].start_offset = 2.5;
  assert.throws(() => validateDirectorExecution(gap, plan()), /连续|空缺|重叠|时间/);

  const tooMany = execution();
  tooMany.outline_shots[0].timeline_segments = Array.from({ length: 7 }, (_, index) => ({
    start_offset: index * (4 / 7), end_offset: (index + 1) * (4 / 7), duration: 4 / 7,
    prompt: `第${index + 1}个具有足够细节密度的连续画面描述，用于验证微镜头数量上限。`
  }));
  assert.throws(() => validateDirectorExecution(tooMany, plan()), /1.*6|micro|微镜头/);
});

test('execution cannot drift source mapping or planned duration', () => {
  const drift = execution();
  drift.outline_shots[1].source_basis = '她发现桌上一把钥匙。';
  assert.throws(() => validateDirectorExecution(drift, plan()), /source_basis|原文|映射/);

  const durationDrift = execution();
  durationDrift.outline_shots[1].duration = 5;
  assert.throws(() => validateDirectorExecution(durationDrift, plan()), /时长|duration/);
});

test('formatter emits current V88 card/timeline syntax without exposing planning metadata', () => {
  const output = formatDirectorPipelineOutput(execution(), plan());
  assert.match(output, /### 分镜一（总时长：4s）/);
  assert.match(output, /00:00-00:02 \| 中景｜平视｜缓慢跟进 \|/);
  assert.match(output, /### 分镜二（总时长：6s）/);
  assert.doesNotMatch(output, /narrative_function|continuity_in|batch_id|global_director_plan/);
});
