const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BATCH_FACTORY_PRESET_REQUIREMENTS,
  defaultBody,
  isPublishedPresetAllowed,
  listPublishedForSlot,
  seedSystemPresets,
  SYSTEM_PRESETS
} = require('./system-preset-catalog');

test('Batch Factory extraction accepts only the combined people-scene-prop preset', () => {
  assert.equal(isPublishedPresetAllowed(
    { id: 'script-extract-assets', module: 'script', kind: 'base', extractionPreset: true, protocolLock: { format: 'extract', slot: 'script.asset-extraction' } },
    BATCH_FACTORY_PRESET_REQUIREMENTS['assets.extraction']
  ), true);
  assert.equal(isPublishedPresetAllowed(
    { id: 'script-extract', module: 'script', kind: 'base', extractionPreset: true, protocolLock: { format: 'extract', slot: 'script.extract' } },
    BATCH_FACTORY_PRESET_REQUIREMENTS['assets.extraction']
  ), false);
});

test('seeding upgrades only the shipped invalid script extraction example to the corrected JSON contract', () => {
  const extraction = SYSTEM_PRESETS.find(preset => preset.id === 'script-extract');
  const legacy = extraction.body.replace(/\r\n/g, '\n')
    .replace('    }\n  ],\n  "场景设定": [', '    },\n    \n  "场景设定": [')
    .replace('    }\n  ]\n}', '    },\n  ]\n}');
  const published = new Map([[extraction.id, { ...extraction, body: legacy, version: 3, status: 'published' }]]);
  const drafts = new Map();
  const store = {
    getPublished: id => published.get(id) || null,
    createDraft: (_, input) => {
      const draft = { ...input, version: (published.get(input.id)?.version || 0) + 1 };
      drafts.set(input.id, draft);
      return draft;
    },
    publish: (_, id) => {
      const publishedDraft = { ...drafts.get(id), status: 'published' };
      published.set(id, publishedDraft);
      return publishedDraft;
    }
  };

  seedSystemPresets(store, 'admin');

  assert.equal(published.get(extraction.id).version, 4);
  assert.equal(published.get(extraction.id).body, extraction.body.trim());
});

test('seeding preserves a script extraction template customized only with leading whitespace', () => {
  const extraction = SYSTEM_PRESETS.find(preset => preset.id === 'script-extract');
  const legacy = extraction.body.replace(/\r\n/g, '\n')
    .replace('    }\n  ],\n  "场景设定": [', '    },\n    \n  "场景设定": [')
    .replace('    }\n  ]\n}', '    },\n  ]\n}');
  const customized = `\n${legacy}`;
  const published = new Map([[extraction.id, { ...extraction, body: customized, version: 3, status: 'published' }]]);
  const drafts = new Map();
  const store = {
    getPublished: id => published.get(id) || null,
    createDraft: (_, input) => {
      const draft = { ...input, version: (published.get(input.id)?.version || 0) + 1 };
      drafts.set(input.id, draft);
      return draft;
    },
    publish: (_, id) => {
      const publishedDraft = { ...drafts.get(id), status: 'published' };
      published.set(id, publishedDraft);
      return publishedDraft;
    }
  };

  seedSystemPresets(store, 'admin');

  assert.equal(published.get(extraction.id).version, 3);
  assert.equal(published.get(extraction.id).body, customized);
});

test('Batch Factory exposes separate character and scene renderers while prop remains a combined extraction output', () => {
	assert.deepEqual(BATCH_FACTORY_PRESET_REQUIREMENTS['assets.character'], { module: 'batch-factory', kind: 'base', slot: 'batch.character-meta' });
	assert.deepEqual(BATCH_FACTORY_PRESET_REQUIREMENTS['assets.scene'], { module: 'batch-factory', kind: 'base', slot: 'batch.scene-meta' });
	assert.equal(BATCH_FACTORY_PRESET_REQUIREMENTS['assets.prop'], undefined);
});

test('Batch Factory provides one combined people-scene-prop extraction preset', () => {
  const combined = SYSTEM_PRESETS.find(preset => preset.id === 'script-extract-assets');
  assert.equal(combined?.protocolLock?.slot, 'script.asset-extraction');
  assert.equal(combined?.protocolLock?.format, 'extract');
  assert.match(combined?.body || '', /人物场景道具统一提取/);
});

test('Batch Factory storyboard meta default contains the full script segmented-opening and shotlist bodies', () => {
  const storyboard = SYSTEM_PRESETS.find(preset => preset.id === 'batch-video-meta');
  assert.match(storyboard?.body || '', /## 剧本生成预设：分段开头/);
  assert.match(storyboard?.body || '', /先全文理解，再开始分段/);
  assert.match(storyboard?.body || '', /## 剧本生成预设：分镜模式/);
  assert.match(storyboard?.body || '', /每条画面的完整导演信息/);
  assert.match(storyboard?.body || '', /Batch Factory V11 JSON 输出适配/);
  assert.doesNotMatch(storyboard?.body || '', /^你负责把导演结果组织成可执行的视频分镜描述/);
});

test('Batch Factory publishes the H3 director VIDEO renderer as a selectable video preset', () => {
	const h3 = SYSTEM_PRESETS.find(preset => preset.id === 'batch-video-h3-director');
	assert.equal(h3?.protocolLock?.slot, 'batch.video-meta');
	assert.equal(h3?.protocolLock?.key, 'h3-video-normal');
	for (const requiredRule of ['H3_DIRECTOR_R8_FULL_RULESET_V1', '通用小说剧情脑补与段内微镜头硬约束', '每个非空原文行固定对应一张外层分镜卡', '1到6个micro_shots', 'character_slot_ids', '180度轴线', '不负责最终精确总时长数学']) {
		assert.match(h3?.body || '', new RegExp(requiredRule));
	}
});

test('Batch Factory H3 director preset retains the original H3 R8 director protocol', () => {
  const h3 = SYSTEM_PRESETS.find(preset => preset.id === 'batch-video-h3-director');
  const body = h3?.body || '';
  assert.match(body, /通用小说剧情脑补与段内微镜头硬约束｜V78\.3\.0\.17 R8/);
  assert.match(body, /顶层固定为 \{"timeline_segments":\[\.\.\.\]\}/);
  assert.match(body, /scene_id、location、axis、light_direction、positions、facings、gazes、held_props、action_ends/);
});

test('H3 selectable presets embed the complete supplied V78.3.0.59 rule bodies instead of adapted summaries', () => {
  const smart = defaultBody('script-constraint-prefix-smart-unified');
  const assets = defaultBody('batch-assets-h3');
  const director = defaultBody('batch-video-h3-director');

  // Distinctive source-only clauses make this a provenance test, rather than
  // a test that accepts a hand-written paraphrase of the H3 protocols.
  assert.match(smart, /【V78\.3\.0\.59 最新版｜内容类型与统一风格质量协议】/);
  assert.match(smart, /\{\{\.StyleAdvice\}\}/);
  assert.match(assets, /【V59 AUTO正式人物名单判断｜只确定正式人物基础身份】/);
  assert.match(assets, /\{\{\.ForcedRoster\}\}/);
  assert.match(assets, /【V52通用小说人物关系图与分镜选角Skill｜关系图独立，只读人物卡】/);
  assert.match(assets, /【V55人物卡外形隔离系统规则｜人物外形接口最终系统级规则】/);
  assert.match(director, /【v78\.3\.0\.59 H3普通模式｜整段分镜质量冻结母版】/);
  assert.match(director, /\{\{\.H3_CANONICAL_PROMPT\}\}/);
});

test('Batch Factory publishes H3 as one complete asset scheme in the unified selector', () => {
	const h3 = SYSTEM_PRESETS.find(preset => preset.id === 'batch-assets-h3');
	assert.equal(h3?.module, 'script');
	assert.equal(h3?.protocolLock?.slot, 'script.asset-extraction');
	assert.equal(h3?.protocolLock?.key, 'h3-assets-full');
	assert.match(h3?.body || '', /一次模型请求、一个 JSON 返回/);
	assert.match(h3?.body || '', /V59 AUTO正式人物名单判断/);
	assert.match(h3?.body || '', /V55人物卡外形隔离系统规则/);
});

test('seeding upgrades only the shipped abbreviated H3 director rule to the full R8 rule', () => {
  const h3 = SYSTEM_PRESETS.find(preset => preset.id === 'batch-video-h3-director');
  const legacy = [
    '## H3 导演分镜 VIDEO 输出规则', '',
    '以人物、场景、道具、原文事实和当前镜头连续性为唯一依据。先在内部保持 Scene Memory：场景、空间轴线、人物站位、朝向、视线、手持道具、光线与动作结束状态必须能衔接下一镜。', '',
    '每个 VIDEO 必须输出可拍、可见的镜头动作；明确景别、机位、运镜与节奏。人物必须引用已确认的人物资产，禁止临时改写身份、外观或关系。不要用空镜、重复动作或静止画面填充时长。', '',
    '最终 VIDEO 由批量工厂 H3 编译器生成：人物定义、视听分层、H3 时间轴和无字幕画面规则均由后端根据结构化分镜输出，浏览器不得拼接或伪造。'
  ].join('\n');
  const published = new Map([[h3.id, { ...h3, body: legacy, version: 1, status: 'published' }]]);
  const drafts = new Map();
  const store = {
    getPublished: id => published.get(id) || { id, body: `custom ${id}`, version: 1, status: 'published', protocolLock: {} },
    createDraft: (_, input) => { const draft = { ...input, version: (published.get(input.id)?.version || 0) + 1 }; drafts.set(input.id, draft); return draft; },
    publish: (_, id) => { const draft = drafts.get(id); published.set(id, { ...draft, status: 'published' }); return published.get(id); }
  };
  seedSystemPresets(store, 'admin');
  assert.match(published.get(h3.id).body, /H3_DIRECTOR_R8_FULL_RULESET_V1/);
});

test('seeding upgrades only the shipped two-call H3 asset rule to the one-call full rule', () => {
  const h3 = SYSTEM_PRESETS.find(preset => preset.id === 'batch-assets-h3');
  const legacy = [
    '# H3 人物场景道具提取', '',
    '仅当用户在“人物场景道具提示词”选择本方案时执行。本方案独立于普通提取方案；不会追加、修改或覆盖任何普通人物、场景或道具提示词。', '',
    '## 调用一：H3 人物场景道具事实提取', '',
    '只输出合法 JSON：{"characters":[{"name":"人物名","prompt":"可追溯的人物事实与外形依据"}],"scenes":[],"props":[]}。', '',
    '## 调用二：H3 全人物外形编译', '',
    '只输出 JSON：{"characters":[{"character_id":"C001","name":"输入姓名","prompt":"该人物完整外形正文"}]}。'
  ].join('\n');
  const published = new Map([[h3.id, { ...h3, description: 'H3 两次调用：资产事实提取后一次编译全部人物详细外形', body: legacy, version: 1, status: 'published' }]]);
  const drafts = new Map();
  const store = {
    getPublished: id => published.get(id) || null,
    createDraft: (_, input) => { const draft = { ...input, version: (published.get(input.id)?.version || 0) + 1 }; drafts.set(input.id, draft); return draft; },
    publish: (_, id) => { published.set(id, { ...drafts.get(id), status: 'published' }); return published.get(id); }
  };
  seedSystemPresets(store, 'admin');
  const upgraded = published.get(h3.id);
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.description, h3.description);
  assert.match(upgraded.body, /一次模型请求、一个 JSON 返回/);
  assert.match(upgraded.body, /V55人物卡外形隔离系统规则/);
});

test('Batch Factory extraction lists every published combined asset preset in its dedicated slot', () => {
  const records = [
    { id: 'script-extract-assets', name: '默认统一提取', module: 'script', kind: 'base', status: 'published', version: 2, protocolLock: { slot: 'script.asset-extraction', format: 'extract' } },
    { id: 'script-extract-assets-female', name: '女频统一提取', module: 'script', kind: 'base', status: 'published', version: 1, protocolLock: { slot: 'script.asset-extraction', format: 'extract' } },
    { id: 'script-extract', name: '人物场景提取', module: 'script', kind: 'base', status: 'published', version: 3, protocolLock: { slot: 'script.extract', format: 'extract' } }
  ];
  const listed = listPublishedForSlot({ listAll: () => records }, 'script.asset-extraction');
  assert.deepEqual(listed.map(item => item.id), ['script-extract-assets', 'script-extract-assets-female']);
});

test('Batch Factory constraint selections accept only published script constraint slots', () => {
  const constraint = { module: 'script', kind: 'addon', protocolLock: { format: 'constraint', slot: 'script.constraint.quality' } };
  assert.equal(isPublishedPresetAllowed(constraint, BATCH_FACTORY_PRESET_REQUIREMENTS.constraints), true);
  assert.equal(isPublishedPresetAllowed({ ...constraint, kind: 'base' }, BATCH_FACTORY_PRESET_REQUIREMENTS.constraints), false);
});

test('publishes H3 shot narrative and visual stability as independently selectable Chinese constraints', () => {
  const shotNarrative = SYSTEM_PRESETS.find(preset => preset.id === 'script-constraint-quality-h3-shot-narrative');
  const visualPolicy = SYSTEM_PRESETS.find(preset => preset.id === 'script-constraint-restriction-h3-visual-policy');
  assert.equal(shotNarrative?.protocolLock?.category, 'quality');
  assert.match(shotNarrative?.body || '', /严格依次呈现列出的场景与镜头/);
  assert.match(shotNarrative?.body || '', /人物情绪和关系主要通过视线、手势、肢体动作/);
  assert.doesNotMatch(shotNarrative?.body || '', /AUDIOVISUAL PRESENTATION/);
  assert.equal(visualPolicy?.protocolLock?.category, 'restriction');
  assert.match(visualPolicy?.body || '', /人物身份、年龄、脸型、五官、发型、服装和饰品/);
});

test('smart unified preset owns the editable H3 style.system protocol', () => {
  const body = defaultBody('script-constraint-prefix-smart-unified');
  assert.match(body, /H3 `style\.system`/);
  assert.match(body, /"final_genre"/);
  assert.match(body, /"trailer_style"/);
  assert.match(body, /"story_era"/);
});

test('seeding upgrades the untouched smart-unified placeholder and its description to H3 style.system', () => {
  const smartUnified = SYSTEM_PRESETS.find(preset => preset.id === 'script-constraint-prefix-smart-unified');
  const published = new Map([[smartUnified.id, {
    ...smartUnified,
    description: '根据当前项目分析结果统一全片视觉风格的画面前缀词',
    body: [
      '【智能统一画面前缀】', '',
      '使用当前项目分析得到的统一视觉风格，作为全片所有镜头的画面前缀。', '',
      '统一控制：影像媒介、色彩体系、光线质感、明暗关系、对比度、饱和度、颗粒感、镜头质感、氛围和整体美术风格。', '',
      '不得改变或新增剧情、人物身份、人物造型、场景内容、道具、动作、台词和事件顺序。', '',
      '不要在最终分镜中单独输出“统一风格”标题，只需将该内容作为“画面前缀词”作用于每个镜头。', '',
      '如果没有有效的风格分析结果，则根据原文自动判断一种统一视觉风格，并保持全片一致。'
    ].join('\n'),
    version: 1,
    status: 'published'
  }]]);
  const drafts = new Map();
  const store = {
    getPublished: id => published.get(id) || null,
    createDraft: (_, input) => {
      const draft = { ...input, version: (published.get(input.id)?.version || 0) + 1 };
      drafts.set(input.id, draft);
      return draft;
    },
    publish: (_, id) => {
      const draft = drafts.get(id);
      published.set(id, { ...draft, status: 'published' });
      return published.get(id);
    }
  };
  seedSystemPresets(store, 'admin');
  const upgraded = published.get(smartUnified.id);
  assert.equal(upgraded.description, 'H3 style.system：按视频原文分析内容类型、时代与统一视觉风格');
  assert.match(upgraded.body, /H3 `style\.system`/);
  assert.match(upgraded.body, /"final_genre"/);
});

test('seeding upgrades the shipped Chinese-label smart-unified V3 body to the H3 style.system contract', () => {
  const smartUnified = SYSTEM_PRESETS.find(preset => preset.id === 'script-constraint-prefix-smart-unified');
  const published = new Map([[smartUnified.id, {
    ...smartUnified,
    version: 3,
    status: 'published',
    body: [
      '你是全片统一视觉分析师。',
      '最终将十一项视觉判断融合成一条紧凑、专业、可直接作为后续所有分镜画面提示词共同摄影前缀使用的：',
      '`统一风格附加视觉信息`',
      '【最终输出】',
      '内容类型：XXXX短剧',
      '统一风格附加视觉信息：XXXX'
    ].join('\n')
  }]]);
  const drafts = new Map();
  const store = {
    getPublished: id => published.get(id) || null,
    createDraft: (_, input) => {
      const draft = { ...input, version: (published.get(input.id)?.version || 0) + 1 };
      drafts.set(input.id, draft);
      return draft;
    },
    publish: (_, id) => {
      const draft = drafts.get(id);
      published.set(id, { ...draft, status: 'published' });
      return published.get(id);
    }
  };

  seedSystemPresets(store, 'admin');

  const upgraded = published.get(smartUnified.id);
  assert.equal(upgraded.version, 4);
  assert.match(upgraded.body, /H3 `style\.system`/);
  assert.match(upgraded.body, /"final_genre"/);
  assert.doesNotMatch(upgraded.body, /统一风格附加视觉信息：XXXX/);
});

test('seeding upgrades the untouched legacy Batch Factory video body to the complete script-preset composition', () => {
  const published = new Map([['batch-video-meta', {
    id: 'batch-video-meta', module: 'batch-factory', name: '视频提示词元提示词', kind: 'base',
    description: '批量工厂视频单元、镜头与整数时间轴规则', compatibleBaseIds: [], body: '你负责把导演结果组织成可执行的视频分镜描述。\n\n规则：旧版默认正文',
    protocolLock: { slot: 'batch.video-meta' }, version: 1, status: 'published'
  }]]);
  const drafts = new Map();
  const store = {
    getPublished: id => published.get(id) || null,
    createDraft: (_, input) => { const draft = { ...input, version: (published.get(input.id)?.version || 0) + 1 }; drafts.set(input.id, draft); return { id: draft.id, version: draft.version }; },
    publish: (_, id) => { published.set(id, { ...drafts.get(id), status: 'published' }); return published.get(id); }
  };
  seedSystemPresets(store, 'choushiyiguai');
  const upgraded = published.get('batch-video-meta');
  const body = upgraded.body;
  assert.equal(upgraded.name, '分镜元提示词（自动组合）');
  assert.equal(upgraded.description, '自动组合剧本生成的分段开头与分镜模式；批量工厂只保留 JSON 分镜输出协议');
  assert.match(body, /剧本生成预设：分段开头/);
  assert.match(body, /剧本生成预设：分镜模式/);
  assert.match(body, /Batch Factory V11 JSON 输出适配/);
  assert.doesNotMatch(body, /旧版默认正文/);
});
