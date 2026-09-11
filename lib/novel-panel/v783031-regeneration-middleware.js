'use strict';

const VERSION = 'v78.3.0.31';
const OPERATION = 'patch_regenerate_current_source_card';
const EPSILON = 0.05;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function sameScene(shot, scene) {
  if (!shot || typeof shot !== 'object' || !scene || typeof scene !== 'object') return false;
  const shotKey = text(shot.source_key);
  const sceneKey = text(scene.source_key);
  if (shotKey && sceneKey) return shotKey === sceneKey;
  const shotIndex = number(shot.source_index);
  const sceneIndex = number(scene.source_index);
  if (shotIndex > 0 && sceneIndex > 0) return shotIndex === sceneIndex;
  const shotParent = text(shot.parent_scene_id);
  const sceneId = text(scene.id);
  return Boolean(shotParent && sceneId && shotParent === sceneId);
}

function baselineShots(body = {}) {
  const scene = body.scene && typeof body.scene === 'object' ? body.scene : {};
  const sceneShots = list(scene.outline_shots);
  if (sceneShots.length) return clone(sceneShots);
  const all = list(body.outline_shots);
  const matching = all.filter(shot => sameScene(shot, scene));
  if (matching.length) return clone(matching);
  return all.length === 1 ? clone(all) : [];
}

function segmentDuration(segment = {}) {
  const explicit = number(segment.duration ?? segment.seconds ?? segment.total_seconds);
  if (explicit > 0) return explicit;
  const start = number(segment.start_offset ?? segment.start);
  const end = number(segment.end_offset ?? segment.end);
  return end > start ? end - start : 0;
}

function shotDuration(shot = {}) {
  const segments = list(shot.timeline_segments);
  if (segments.length) {
    const total = segments.reduce((sum, item) => sum + segmentDuration(item), 0);
    if (total > 0) return total;
  }
  return segmentDuration(shot);
}

function totalDuration(shots) {
  return list(shots).reduce((sum, shot) => sum + shotDuration(shot), 0);
}

function existingSegments(shots) {
  const output = [];
  list(shots).forEach(shot => {
    const segments = list(shot.timeline_segments);
    if (segments.length) {
      segments.forEach(segment => output.push(clone(segment)));
      return;
    }
    output.push({
      duration: shotDuration(shot),
      prompt: text(shot.prompt || shot.visual_prompt || shot.description || shot.content),
      micro_shots: clone(list(shot.micro_shots)),
    });
  });
  return output.filter(segment => segmentDuration(segment) > 0 || text(segment.prompt) || list(segment.micro_shots).length);
}

function lockedMicroSlots(segments) {
  const slots = [];
  list(segments).forEach(segment => {
    list(segment.micro_shots).forEach(item => {
      const start = number(item && item.start);
      const end = number(item && item.end);
      if (end > start || (start === 0 && end === 0)) {
        slots.push({ start, end });
      }
    });
  });
  return slots;
}

function structureChangeRequested(guidance) {
  return /(?:重新?拆镜|重拆|重新分镜|增加(?:一个|一条|\d+个)?(?:反应)?镜头|新增(?:一个|一条|\d+个)?镜头|减少镜头|删(?:掉|除)?(?:一个|一条|\d+个)?镜头|合并镜头|拆分镜头|调整镜头结构|改变镜头结构|修改镜头结构|重做镜头结构|允许调整micro[_ -]?shots?|改变micro[_ -]?shots?)/i.test(text(guidance));
}

function buildEditTasks(guidance) {
  const raw = text(guidance);
  if (!raw) return [];
  const parts = raw.split(/[\n；;]+/).map(text).filter(Boolean).slice(0, 12);
  return (parts.length ? parts : [raw]).map((instruction, index) => ({ id: `change_${index + 1}`, instruction }));
}

function contentStrings(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  const contentKeys = ['prompt', 'visual_prompt', 'description', 'content', 'visual', 'visual_context', 'composition', 'performance', 'shot_task', 'shot_size', 'view_angle', 'movement', 'lighting', 'rhythm', 'speed_treatment'];
  for (const key of contentKeys) {
    if (typeof value[key] === 'string' && text(value[key])) output.push(`${key}:${text(value[key])}`);
  }
  for (const key of ['timeline_segments', 'micro_shots']) {
    list(value[key]).forEach(item => contentStrings(item, output));
  }
  return output;
}

function visualSignature(shots) {
  return list(shots).flatMap(shot => contentStrings(shot, [])).join('\n').replace(/\s+/g, ' ').trim();
}

function responseAppliedChangeIds(result) {
  const values = [];
  list(result && result.applied_change_ids).forEach(id => values.push(text(id)));
  list(result && result.outline_shots).forEach(shot => list(shot && shot.applied_change_ids).forEach(id => values.push(text(id))));
  return [...new Set(values.filter(Boolean))];
}

function responseMicroSlots(shots) {
  return lockedMicroSlots(existingSegments(shots));
}

function patchRuleBlock(contract) {
  const locked = contract.preserve_total_duration
    ? `原卡已有有效时间轴：总时长绝对锁定为 ${contract.locked_duration} 秒，不得增加、减少或重新分配外层总时长。`
    : '当前卡没有可用旧时间轴：允许依据当前原文补建一张卡。';
  const micro = contract.preserve_micro_structure
    ? `用户没有明确要求改变镜头结构：micro_shots数量与每个start/end时间槽全部锁定。locked_micro_slots=${JSON.stringify(contract.locked_micro_slots)}。只修改槽内画面内容。`
    : (contract.allow_structure_change
      ? '用户明确要求改变镜头结构：允许调整micro_shots结构，但外层总时长仍绝对锁定。'
      : '没有可锁定的micro_shots时间槽；不得无故扩写剧情。');
  const taskText = contract.edit_tasks.length
    ? `必须执行edit_tasks=${JSON.stringify(contract.edit_tasks)}，并在返回JSON顶层给出applied_change_ids，至少包含全部任务id：${contract.edit_tasks.map(item => item.id).join('、')}。`
    : '未提供补充修改意见：只允许做必要的准确性修正，不得自作主张重拆结构。';
  return [
    '【V78.3.0.27/28 单条Patch Current Truth硬协议】',
    `operation=${OPERATION}。这是已有当前卡的定向Patch，不是重新创作整段分镜。`,
    'current scene 与 existing_segments 是本次唯一有效的当前真值；existing_segments 是待修改底稿，不得回退到历史缓存、旧AI结果或题材模板。',
    locked,
    micro,
    taskText,
    '只修改用户补充意见明确指出的问题及其必要联动内容；补充意见没有要求的剧情事实、人物关系、时间范围和外层卡结构必须保留。',
    '如果补充意见非空，返回画面必须与旧底稿存在可验证的实际修改；禁止原样复述旧visual却声称完成。',
    '仍沿用现有outline_shots返回结构；不要输出解释文字。',
  ].join('\n');
}

function preparePatchRequest(inputBody = {}) {
  const body = clone(inputBody) || {};
  const scene = body.scene && typeof body.scene === 'object' ? body.scene : {};
  const shots = baselineShots(body);
  const segments = existingSegments(shots);
  const locked = totalDuration(shots);
  const guidance = text(scene.guidance || body.guidance);
  const allowStructure = structureChangeRequested(guidance);
  const slots = lockedMicroSlots(segments);
  const editTasks = buildEditTasks(guidance);
  const contract = {
    version: VERSION,
    operation: OPERATION,
    patch_mode: shots.length ? 'modify_existing' : 'create_missing',
    scene_id: text(scene.id),
    source_key: text(scene.source_key),
    source_index: number(scene.source_index),
    guidance,
    edit_tasks: editTasks,
    preserve_total_duration: locked > 0,
    locked_duration: locked > 0 ? locked : 0,
    duration_authority: locked > 0 ? 'existing_card_locked' : 'ai_director_missing_baseline',
    allow_structure_change: allowStructure,
    preserve_micro_structure: locked > 0 && !allowStructure && slots.length > 0,
    locked_micro_slots: slots,
    existing_segments: clone(segments),
    baseline_shots: clone(shots),
    baseline_visual_signature: visualSignature(shots),
  };
  body.scene = {
    ...scene,
    operation: OPERATION,
    patch_mode: contract.patch_mode,
    existing_segments: clone(segments),
    edit_tasks: clone(editTasks),
    timing_context: {
      ...(scene.timing_context && typeof scene.timing_context === 'object' ? scene.timing_context : {}),
      locked_duration: contract.locked_duration,
      allocated_seconds: contract.locked_duration,
      recommended_current_seconds: contract.locked_duration || 4,
      maximum_current_seconds: contract.locked_duration || 120,
      preserve_total_duration: contract.preserve_total_duration,
      preserve_micro_structure: contract.preserve_micro_structure,
      allow_structure_change: contract.allow_structure_change,
      locked_micro_slots: clone(contract.locked_micro_slots),
      duration_authority: contract.duration_authority,
    },
  };
  const rules = patchRuleBlock(contract);
  body.generation_rules = [text(body.generation_rules), rules].filter(Boolean).join('\n\n');
  body.shot_rhythm_requirements = [text(body.shot_rhythm_requirements), contract.preserve_micro_structure ? '单条Patch未要求结构变化：锁定当前micro_shots数量和start/end时间槽。' : '单条Patch仅在用户明确要求时允许调整micro_shots结构。'].filter(Boolean).join('\n');
  if (guidance) body.must_cover_details = [text(body.must_cover_details), `当前分镜补充建议（本镜最高优先级）：${guidance}`].filter(Boolean).join('\n');
  return { body, contract };
}

function validatePatchResponse(result = {}, contract = {}) {
  const issues = [];
  if (!result || typeof result !== 'object' || !Array.isArray(result.outline_shots) || !result.outline_shots.length) {
    return { ok: false, issues: ['单条Patch没有返回可验证的outline_shots，旧卡必须保留。'] };
  }
  const shots = result.outline_shots;
  if (contract.preserve_total_duration) {
    const actual = totalDuration(shots);
    if (!(actual > 0)) issues.push(`单条改稿必须返回可验证的duration；原卡总时长锁定为${contract.locked_duration}秒。`);
    else if (Math.abs(actual - number(contract.locked_duration)) > EPSILON) issues.push(`单条改稿duration必须严格保持原卡${contract.locked_duration}秒；AI返回${actual}秒。`);
  }
  if (contract.preserve_micro_structure) {
    const expected = list(contract.locked_micro_slots);
    const actual = responseMicroSlots(shots);
    if (expected.length !== actual.length) {
      issues.push(`单条改稿未要求结构变化，micro_shot时间槽数量必须保持${expected.length}个；AI返回${actual.length}个。`);
    } else {
      expected.forEach((slot, index) => {
        const got = actual[index] || {};
        if (Math.abs(number(slot.start) - number(got.start)) > EPSILON || Math.abs(number(slot.end) - number(got.end)) > EPSILON) {
          issues.push(`单条改稿第${index + 1}个micro_shot时间槽必须保持${number(slot.start)}-${number(slot.end)}秒，不得重新分配时间。`);
        }
      });
    }
  }
  const expectedIds = list(contract.edit_tasks).map(item => text(item && item.id)).filter(Boolean);
  if (expectedIds.length) {
    const returnedIds = responseAppliedChangeIds(result);
    const missing = expectedIds.filter(id => !returnedIds.includes(id));
    if (missing.length) issues.push(`单条Patch返回缺少applied_change_ids：${missing.join('、')}。`);
    const nextSignature = visualSignature(shots);
    if (text(contract.baseline_visual_signature) && nextSignature === text(contract.baseline_visual_signature)) {
      issues.push('补充意见非空，但AI返回画面与当前底稿没有产生实际画面修改；旧卡必须保留。');
    }
  }
  return { ok: issues.length === 0, issues };
}

function createV783031RegenerationMiddleware() {
  return function v783031RegenerationMiddleware(req, res, next) {
    if (!req || req.method !== 'POST') return next();
    const prepared = preparePatchRequest(req.body || {});
    req.body = prepared.body;
    req.v783031PatchContract = prepared.contract;
    const originalJson = res.json.bind(res);
    res.json = payload => {
      if (res.statusCode >= 400 || !payload || typeof payload !== 'object' || payload.applied !== true) return originalJson(payload);
      const validation = validatePatchResponse(payload, prepared.contract);
      if (!validation.ok) {
        res.status(422);
        return originalJson({
          applied: false,
          code: 'V783028_PATCH_CONTRACT_BLOCKED',
          reason: 'patch_current_truth_validation_failed',
          error: validation.issues.join('；'),
          issues: validation.issues,
          operation: OPERATION,
          retained_previous_result: true,
          timing_context: {
            locked_duration: prepared.contract.locked_duration,
            preserve_total_duration: prepared.contract.preserve_total_duration,
            preserve_micro_structure: prepared.contract.preserve_micro_structure,
            allow_structure_change: prepared.contract.allow_structure_change,
            duration_authority: prepared.contract.duration_authority,
          },
        });
      }
      return originalJson({
        ...payload,
        operation: OPERATION,
        patch_mode: prepared.contract.patch_mode,
        duration_authority: prepared.contract.duration_authority,
        locked_duration: prepared.contract.locked_duration,
        preserve_total_duration: prepared.contract.preserve_total_duration,
        preserve_micro_structure: prepared.contract.preserve_micro_structure,
        v783031_patch_contract: true,
      });
    };
    return next();
  };
}

module.exports = {
  VERSION,
  OPERATION,
  preparePatchRequest,
  validatePatchResponse,
  createV783031RegenerationMiddleware,
  _private: {
    baselineShots,
    existingSegments,
    totalDuration,
    lockedMicroSlots,
    structureChangeRequested,
    buildEditTasks,
    visualSignature,
  },
};
