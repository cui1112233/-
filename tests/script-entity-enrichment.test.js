const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const chat = require('../routes/chat');

const presetStore = {
  getPublished(id) {
    if (id === 'script-extract-current') return { id, module: 'script', kind: 'base', body: '提取协议', protocolLock: { format: 'extract' } };
    return null;
  },
  listCatalog() {
    return [{ id: 'script-extract-current', module: 'script', kind: 'base', protocolLock: { format: 'extract' } }];
  },
  listAll() {
    return [];
  }
};

test('entity enrichment only fills empty fields and preserves manual values', async () => {
  const { applyEntityEnrichment } = await import('../frontend/src/user/pages/scriptEntityEnrichment.js');
  const result = applyEntityEnrichment(
    { '名称': '林薇', '身份': '小三', '外形': '', '性格': '' },
    { fields: { '名称': '林秘书', '身份': '秘书', '外形': '黑色长卷发', '性格': '善于伪装' } }
  );
  assert.deepEqual(result, { '名称': '林薇', '身份': '小三', '外形': '黑色长卷发', '性格': '善于伪装' });
});

test('normalizes enrichment display data and excludes edited entity from context summary', async () => {
  const { compactEntitySummary, normalizeEntityEnrichment } = await import('../frontend/src/user/pages/scriptEntityEnrichment.js');
  const summary = compactEntitySummary({
    characters: [{ id: 'editing', data: { '名称': '林薇' } }, { id: 'other', data: { '名称': '顾沉', '身份': '总裁' } }],
    scenes: [{ id: 'scene', data: { '名称': '酒店套房' } }]
  }, 'editing');
  assert.deepEqual(summary.characters, [{ '名称': '顾沉', '身份': '总裁' }]);
  assert.deepEqual(summary.scenes, [{ '名称': '酒店套房' }]);
  assert.deepEqual(normalizeEntityEnrichment({ evidence: ['原文第3段'], uncertainties: ['关系未明'] }).uncertainties, ['关系未明']);
});

test('builds entity enrichment messages from a published extraction preset with manual-field protection', () => {
  const messages = chat._private.buildEntityEnrichmentMessages({
    entityType: 'character', novelText: '林薇走进办公室。',
    entity: { '名称': '林薇', '身份': '小三', '外形': '' },
    existingEntitySummary: { characters: [{ '名称': '顾沉' }], scenes: [] },
    extractionPreset: 'script-extract-current'
  }, presetStore);
  assert.match(messages[0].content, /小说原文为主要依据/);
  assert.match(messages[0].content, /不得覆盖用户已填写的非空字段/);
  assert.match(messages[0].content, /uncertainties/);
  assert.match(messages[1].content, /林薇走进办公室/);
});

test('parses fenced entity enrichment JSON and rejects invalid entity inputs', () => {
  assert.deepEqual(chat._private.parseEntityEnrichment('```json\n{"fields":{"外形":"黑发"},"uncertainties":["待确认"]}\n```'), {
    fields: { '外形': '黑发' }, evidence: [], suggestions: [], uncertainties: ['待确认']
  });
  assert.throws(() => chat._private.validateEntityEnrichmentBody({ entityType: 'bad', novelText: '小说', entity: { '名称': '林薇' } }, presetStore), /Invalid entity type/);
  assert.throws(() => chat._private.validateEntityEnrichmentBody({ entityType: 'character', novelText: '', entity: { '名称': '林薇' } }, presetStore), /Novel text is required/);
});

test('entity enrichment client posts only the dedicated entity_enrich request contract', () => {
  const source = fs.readFileSync('frontend/src/shared/api/generation.js', 'utf8');
  assert.match(source, /export function enrichScriptEntity/);
  assert.match(source, /promptType:\s*'entity_enrich'/);
  assert.match(source, /entityType/);
  assert.match(source, /existingEntitySummary/);
});