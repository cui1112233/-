const assert = require('node:assert/strict');
const {
  preparePatchRequest,
  validatePatchResponse,
  createV783031RegenerationMiddleware,
} = require('../lib/novel-panel/v783031-regeneration-middleware');

const baseline = {
  novel_text: '她推门走进会议室。',
  generation_rules: '保持电影感。',
  must_cover_details: '必须拍到推门动作。',
  shot_rhythm_requirements: '节奏克制。',
  scene: {
    id: 'scene-1',
    source_key: 'source-1',
    source_index: 1,
    source_text: '她推门走进会议室。',
    guidance: '把第一个镜头改成先拍门把手特写，再切她进入。',
  },
  outline_shots: [{
    id: 'shot-1',
    source_key: 'source-1',
    source_index: 1,
    duration: 6,
    timeline_segments: [{
      duration: 6,
      start_offset: 0,
      end_offset: 6,
      prompt: '中景，她推门进入会议室。',
      micro_shots: [
        { start: 0, end: 2, visual: '中景，她走到门前。' },
        { start: 2, end: 6, visual: '她推门进入会议室。' },
      ],
    }],
  }],
};

const prepared = preparePatchRequest(baseline);
assert.equal(prepared.contract.operation, 'patch_regenerate_current_source_card');
assert.equal(prepared.contract.locked_duration, 6);
assert.equal(prepared.contract.preserve_total_duration, true);
assert.equal(prepared.contract.preserve_micro_structure, true);
assert.deepEqual(prepared.contract.locked_micro_slots, [{ start: 0, end: 2 }, { start: 2, end: 6 }]);
assert.equal(prepared.body.scene.operation, 'patch_regenerate_current_source_card');
assert.equal(prepared.body.scene.timing_context.duration_authority, 'existing_card_locked');
assert.equal(prepared.body.scene.timing_context.locked_duration, 6);
assert.ok(prepared.body.scene.existing_segments.length > 0);
assert.ok(prepared.body.generation_rules.includes('existing_segments 是待修改底稿'));
assert.ok(prepared.body.generation_rules.includes('applied_change_ids'));
assert.ok(prepared.body.generation_rules.includes('总时长绝对锁定为 6 秒'));

const changed = {
  applied: true,
  applied_change_ids: prepared.contract.edit_tasks.map(x => x.id),
  outline_shots: [{
    source_key: 'source-1',
    source_index: 1,
    duration: 6,
    timeline_segments: [{
      duration: 6,
      start_offset: 0,
      end_offset: 6,
      prompt: '门把手特写，手指压下门把；随后她推门进入会议室。',
      micro_shots: [
        { start: 0, end: 2, visual: '门把手特写，手指压下门把。' },
        { start: 2, end: 6, visual: '她推门进入会议室。' },
      ],
    }],
  }],
};
assert.deepEqual(validatePatchResponse(changed, prepared.contract), { ok: true, issues: [] });

const changedDuration = JSON.parse(JSON.stringify(changed));
changedDuration.outline_shots[0].duration = 7;
changedDuration.outline_shots[0].timeline_segments[0].duration = 7;
changedDuration.outline_shots[0].timeline_segments[0].end_offset = 7;
assert.match(validatePatchResponse(changedDuration, prepared.contract).issues.join('\n'), /严格保持原卡6秒/);

const changedSlots = JSON.parse(JSON.stringify(changed));
changedSlots.outline_shots[0].timeline_segments[0].micro_shots[0].end = 3;
changedSlots.outline_shots[0].timeline_segments[0].micro_shots[1].start = 3;
assert.match(validatePatchResponse(changedSlots, prepared.contract).issues.join('\n'), /micro_shot时间槽/);

const noAppliedIds = JSON.parse(JSON.stringify(changed));
delete noAppliedIds.applied_change_ids;
assert.match(validatePatchResponse(noAppliedIds, prepared.contract).issues.join('\n'), /applied_change_ids/);

const unchanged = {
  applied: true,
  applied_change_ids: prepared.contract.edit_tasks.map(x => x.id),
  outline_shots: JSON.parse(JSON.stringify(baseline.outline_shots)),
};
assert.match(validatePatchResponse(unchanged, prepared.contract).issues.join('\n'), /没有产生实际画面修改/);

const structureRequest = JSON.parse(JSON.stringify(baseline));
structureRequest.scene.guidance = '重新拆镜，增加一个反应镜头，但总时长不变。';
const structurePrepared = preparePatchRequest(structureRequest);
assert.equal(structurePrepared.contract.preserve_micro_structure, false);
assert.equal(structurePrepared.contract.allow_structure_change, true);
assert.equal(structurePrepared.contract.locked_duration, 6);

const middleware = createV783031RegenerationMiddleware();
const req = { method: 'POST', body: JSON.parse(JSON.stringify(baseline)) };
let statusCode = 200;
let sent;
const res = {
  statusCode: 200,
  status(code) { statusCode = code; this.statusCode = code; return this; },
  json(value) { sent = value; return value; },
};
middleware(req, res, () => {
  res.json(changedDuration);
});
assert.equal(statusCode, 422);
assert.equal(sent.applied, false);
assert.equal(sent.code, 'V783028_PATCH_CONTRACT_BLOCKED');

console.log('V78.3.0.27/28 regeneration middleware regression: PASS');
