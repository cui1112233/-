const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN_SOURCE_PATH = path.join(__dirname, '..', 'public', 'batch-rewrite', 'v78-novel-fetch-v2.js');
const CONFIG_SOURCE_PATH = path.join(__dirname, '..', 'public', 'batch-rewrite', 'v78-novel-fetch-v2-config.js');
const LAYOUT_SOURCE_PATH = path.join(__dirname, '..', 'public', 'batch-rewrite', 'v78-novel-fetch-v2-layout.js');
const LEGACY_HTML_PATH = path.join(__dirname, '..', 'frontend', 'public', 'batch-rewrite', 'index.html');
const mainSource = fs.readFileSync(MAIN_SOURCE_PATH, 'utf8');
const configSource = fs.existsSync(CONFIG_SOURCE_PATH) ? fs.readFileSync(CONFIG_SOURCE_PATH, 'utf8') : '';
const layoutSource = fs.existsSync(LAYOUT_SOURCE_PATH) ? fs.readFileSync(LAYOUT_SOURCE_PATH, 'utf8') : '';
const legacyHtml = fs.readFileSync(LEGACY_HTML_PATH, 'utf8');
const source = `${mainSource}\n${configSource}\n${layoutSource}`;

test('processing UI uses sparse target versions and parser-backed preview', () => {
  for (const marker of [
    'v78TargetVersions', 'v78TargetOriginal', 'v78TargetAi1', 'v78TargetAi2', 'v78TargetAi3', 'v78TargetAi4', 'v78TargetAi5',
    'target_versions', 'ai_slot_methods_snapshot', '/process/preview', 'v78ParsedBooks', 'v78BackToInput'
  ]) assert.ok(mainSource.includes(marker), `missing ${marker}`);
  assert.ok(mainSource.includes('本次处理'));
  assert.ok(mainSource.includes('AI文案处理优先方案'));
});

test('processing page is reflowed to the approved image layout instead of stacked add-on cards', () => {
  for (const marker of [
    'mountImageAlignedLayout', 'v78ImageWorkGrid', 'v78ImageInputPanel', 'v78ImageStatusPanel',
    'v78StatusMetrics', 'v78ProgressRows', 'v78WorkActionBar', 'v78CurrentBatchTable'
  ]) assert.ok(layoutSource.includes(marker), `missing ${marker}`);
  assert.ok(layoutSource.includes('批量输入'));
  assert.ok(legacyHtml.includes('处理状态'));
  assert.ok(layoutSource.includes('process-status-section'));
  assert.ok(layoutSource.includes('实时进度'));
  assert.ok(layoutSource.includes('实时日志'));
  assert.ok(layoutSource.includes('grid-template-columns:minmax(0,1.35fr) minmax(360px,1fr)'));
});

test('visual correction follows the blue reference image and keeps preview-friendly empty states', () => {
  for (const marker of [
    '--v78-blue:#1677ff', 'v78BrandBadge', 'V78', 'v78-reference-shell',
    'v78CompactTargets', '登录已过期，请重新登录 V78 后刷新', '请登录后查看当前批次'
  ]) assert.ok(layoutSource.includes(marker), `missing ${marker}`);
  assert.ok(layoutSource.includes("progressRow('原文获取'"));
  assert.ok(layoutSource.includes("progressRow('AI文案生成'"));
  assert.ok(layoutSource.includes("progressRow('121网站提交'"));
  assert.ok(layoutSource.includes('min-height:36px'));
  assert.ok(!layoutSource.includes('color:var(--accent);margin-bottom:8px'));
});

test('processing page exposes current batch controls and table', () => {
  for (const marker of ['/batches/current', '/process/queue/stop', '当前批次', '停止处理', '查看全部任务']) {
    assert.ok(mainSource.includes(marker), `missing ${marker}`);
  }
  assert.ok(!mainSource.includes('V78 自动处理队列'));
  assert.ok(!mainSource.includes('V78 高级任务管理'));
  assert.ok(!mainSource.includes('v78ScheduleRunAt'));
});

test('tasks page exposes history, selected stop, sparse AI display and push date', () => {
  for (const marker of [
    '/batches', '/rerun', '当前任务', '历史批次', '全部重跑', '重跑异常',
    '/tasks/stop-selected', '停止选中', '推送日期', 'selectedAiVersions', 'patchTaskTableForV78'
  ]) assert.ok(mainSource.includes(marker), `missing ${marker}`);
});

test('historical rerun only loads processing form and never auto-starts from rerun handler', () => {
  assert.ok(mainSource.includes('loadHistoricalBatchForRerun'));
  assert.ok(mainSource.includes('preselected_book_ids'));
  const start = mainSource.indexOf('async function loadHistoricalBatchForRerun');
  const end = mainSource.indexOf('\n  async function', start + 1);
  const block = mainSource.slice(start, end > start ? end : undefined);
  assert.ok(!block.includes('/process/queue/start'));
  assert.ok(!block.includes('/process/start'));
});

test('V78 extension preserves server-backed advanced configuration', () => {
  for (const marker of [
    'v78MinOriginalChars',
    'v78SkipShortOriginal',
    'v78AutoReclassifyStyle',
    'v78AutoSyncStyles',
    'v78CleanupEnabled',
    'v78RetentionDays',
    'v78SubmitBatchSize',
    'v78SubmitFlushSeconds',
    'v78ForceSerialBatch',
    'v78SensitiveMode',
    'sensitiveFixSelect',
    "v2Api('/config')",
    "v2Api('/config', { method: 'POST'"
  ]) assert.ok(source.includes(marker), `missing ${marker}`);
  assert.ok(source.includes('deepMergeConfig'));
});

test('V78 config bridge preserves an explicitly selected sensitive_fix preset when legacy save syncs current AI', () => {
  assert.ok(configSource.includes('installSensitiveFixLegacyGuard'));
  assert.ok(configSource.includes('window.syncCurrentAiPreset'));
  assert.ok(configSource.includes("explicit !== '__current__'"));
  assert.ok(configSource.includes('cfg.ai_assignments.sensitive_fix = explicit'));
});

test('V78 extension scripts remain valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(mainSource));
  if (configSource) assert.doesNotThrow(() => new Function(configSource));
  if (layoutSource) assert.doesNotThrow(() => new Function(layoutSource));
});