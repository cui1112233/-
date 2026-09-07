#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, got {count}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str, flags=0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 regex match, got {count}")
    return updated


route_path = ROOT / 'routes/batch-rewrite.js'
route = route_path.read_text(encoding='utf-8')

route = replace_once(
    route,
    "const rewrite = require('../lib/novel-fetch-workshop/rewrite');\n",
    "const rewrite = require('../lib/novel-fetch-workshop/rewrite');\n"
    "const versionSelection = require('../lib/novel-fetch-workshop/version-selection');\n"
    "const { normalizeTargetVersions, targetAiIndexes } = require('../lib/novel-fetch-workshop/target-versions');\n",
    'route imports'
)

new_snake = r'''function snakeTask(task = {}) {
  const bookId = task.bookId || task.book_id || task.id || '';
  const bookName = task.bookName || task.book_name || '';
  const platformId = task.platformId || task.platform_id || '';
  const platformName = task.platformName || task.platform_name || '';
  const selectedVersions = versionSelection.taskSelectedVersions(task);
  const aiFiles = versionSelection.generatedVersions(task);
  const aiCount = selectedVersions.filter(version => /^ai[1-5]$/.test(version)).length;
  const aiSlotMethods = versionSelection.normalizeAiSlotMethods(
    task.aiSlotMethodsSnapshot || task.ai_slot_methods_snapshot || task.aiSlotMethods || task.ai_slot_methods
  );
  return {
    ...task,
    id: bookId,
    book_id: bookId,
    book_name: bookName,
    platform_id: platformId,
    platform_name: platformName,
    parse_mode: task.parseMode || task.parse_mode || '',
    original_status: task.originalStatus || task.original_status || '',
    original_chars: Number(task.originalChars ?? task.original_chars) || 0,
    original_raw_chars: Number(task.originalRawChars ?? task.original_raw_chars) || 0,
    ai_status: task.aiStatus || task.ai_status || '',
    ai_count: aiCount,
    selected_versions: selectedVersions,
    target_versions: selectedVersions,
    ai_slot_methods: aiSlotMethods,
    ai_files: aiFiles,
    classify_status: task.classifyStatus || task.classify_status || '',
    classifier_model: task.classifierModel || task.classifier_model || '',
    sensitive_hit_count: Number(task.sensitiveHitCount ?? task.sensitive_hit_count) || 0,
    sensitive_fixed_count: Number(task.sensitiveFixedCount ?? task.sensitive_fixed_count) || 0,
    sensitive_failed_count: Number(task.sensitiveFailedCount ?? task.sensitive_failed_count) || 0,
    site_submit_status: task.siteSubmitStatus || task.site_submit_status || '',
    site_submit_done_versions: Array.isArray(task.siteSubmitDoneVersions) ? task.siteSubmitDoneVersions : (Array.isArray(task.site_submit_done_versions) ? task.site_submit_done_versions : []),
    site_submit_accepted_versions: Array.isArray(task.siteSubmitAcceptedVersions) ? task.siteSubmitAcceptedVersions : (Array.isArray(task.site_submit_accepted_versions) ? task.site_submit_accepted_versions : []),
    site_submit_failed_versions: Array.isArray(task.siteSubmitFailedVersions) ? task.siteSubmitFailedVersions : (Array.isArray(task.site_submit_failed_versions) ? task.site_submit_failed_versions : [])
  };
}
'''
route = sub_once(
    route,
    r"function snakeTask\(task = \{\}\) \{.*?\n\}\n\nfunction legacyMeta",
    new_snake + "\nfunction legacyMeta",
    'snakeTask',
    re.S
)

route = sub_once(
    route,
    r"function normalizeProfileBindings\(value\) \{.*?\n\}",
    "function normalizeProfileBindings(value) {\n  return versionSelection.normalizeProfileBindings(value);\n}",
    'normalizeProfileBindings',
    re.S
)

old_process_config = '''    const workflow = object(config.workflow);\n    const maxAiCount = Math.max(1, Math.min(Number(config.rewrite?.max_ai_count) || 5, 20));\n    const defaultAiCount = Math.max(1, Math.min(Number(config.rewrite?.default_ai_count) || 1, maxAiCount));\n    const prepared = (parsed.tasks || []).map(item => ({\n      ...item,\n      platformId: String(payload.platform_id || '2'),\n      platformName: platform.name || String(payload.platform_id || '2'),\n      maxTxt: Number(payload.max_txt) || Number(config.fetch?.default_max_txt) || 4000,\n      aiCount: Math.max(1, Math.min(Number(payload.ai_count) || defaultAiCount, maxAiCount))\n    }));\n    report({ type: 'parse', status: 'done', message: `解析完成：有效 ${prepared.length} 个任务。` });\n'''
new_process_config = '''    const workflow = object(config.workflow);\n    const maxAiCount = Math.max(1, Math.min(Number(config.rewrite?.max_ai_count) || 5, 5));\n    const defaultAiCount = Math.max(1, Math.min(Number(config.rewrite?.default_ai_count) || 1, maxAiCount));\n    const hasExplicitVersions = Array.isArray(payload?.selected_versions);\n    const selectedVersions = normalizeTargetVersions(\n      payload?.selected_versions,\n      hasExplicitVersions ? undefined : (Number(payload.ai_count) || defaultAiCount)\n    );\n    if (!selectedVersions.length) throw new Error('请至少选择一个文案版本');\n    const aiSlotMethodsSnapshot = versionSelection.normalizeAiSlotMethods(payload?.ai_slot_methods);\n    const selectedAiIndexes = targetAiIndexes({ targetVersions: selectedVersions });\n    const prepared = (parsed.tasks || []).map(item => ({\n      ...item,\n      platformId: String(payload.platform_id || '2'),\n      platformName: platform.name || String(payload.platform_id || '2'),\n      maxTxt: Number(payload.max_txt) || Number(config.fetch?.default_max_txt) || 4000,\n      targetVersions: selectedVersions,\n      aiSlotMethodsSnapshot,\n      aiCount: selectedAiIndexes.length\n    }));\n    report({ type: 'version_config', status: 'done', message: `版本配置已读取：${selectedVersions.map(version => version.toUpperCase()).join('、')}；有效 ${prepared.length} 个任务。` });\n'''
route = replace_once(route, old_process_config, new_process_config, 'process version config')

route = replace_once(
    route,
    "return rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: task?.meta, count: task?.meta?.aiCount || 1 });",
    "return rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: task?.meta, aiIndexes: targetAiIndexes(task?.meta || {}), slotMethods: task?.meta?.aiSlotMethodsSnapshot });",
    'process auto rewrite'
)

route = replace_once(
    route,
    "await rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: refreshed.meta, count: task.meta.aiCount || 1 });",
    "await rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: refreshed.meta, aiIndexes: targetAiIndexes(refreshed.meta || {}), slotMethods: refreshed.meta?.aiSlotMethodsSnapshot });",
    'batch retry rewrite'
)

route = replace_once(
    route,
    "        const count = Number(task?.meta?.aiGeneratedCount) || 0;\n        for (let index = 1; index <= count; index++) if (await applySavedRulesToVersion(tasks, req.username, id, `ai${index}`, config)) applied++;",
    "        for (const version of versionSelection.generatedVersions(task?.meta || {})) {\n          if (await applySavedRulesToVersion(tasks, req.username, id, version, config)) applied++;\n        }",
    'apply sparse AI rules'
)

old_detail = "router.get('/tasks/:id', async (req, res) => { try { const { tasks } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); if (!task?.meta) return res.status(404).json({ error: '任务不存在' }); const count = Number(task.meta.aiGeneratedCount) || 0; const aiTexts = []; for (let index = 1; index <= count; index++) aiTexts.push({ name: `AI${index}`, text: await tasks.readVersionText(req.username, req.params.id, `ai${index}`) }); const sensitiveLog = await readSensitiveLog(tasks, req.username, req.params.id); res.json({ meta: legacyMeta(task.meta), original: await tasks.readOriginal(req.username, req.params.id), ai_texts: aiTexts, has_original_raw: task.hasOriginalRaw === true, ...sensitiveLog, logs: await tasks.readLogs(req.username, req.params.id) }); } catch (error) { res.status(400).json({ error: error.message }); } });"
new_detail = "router.get('/tasks/:id', async (req, res) => { try { const { tasks } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); if (!task?.meta) return res.status(404).json({ error: '任务不存在' }); const aiTexts = []; for (const version of versionSelection.generatedVersions(task.meta)) aiTexts.push({ name: version.toUpperCase(), version, text: await tasks.readVersionText(req.username, req.params.id, version) }); const sensitiveLog = await readSensitiveLog(tasks, req.username, req.params.id); res.json({ meta: legacyMeta(task.meta), original: await tasks.readOriginal(req.username, req.params.id), ai_texts: aiTexts, has_original_raw: task.hasOriginalRaw === true, ...sensitiveLog, logs: await tasks.readLogs(req.username, req.params.id) }); } catch (error) { res.status(400).json({ error: error.message }); } });"
route = replace_once(route, old_detail, new_detail, 'task detail sparse AI')

old_generate = "router.post('/tasks/:id/generate-ai', async (req, res) => { try { const { tasks, configStore: store } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); if (!task?.meta) throw new Error('任务不存在'); const config = object(store.getConfig()); const max = Math.max(1, Math.min(Number(config.rewrite?.max_ai_count) || 5, 20)); const count = Math.max(1, Math.min(Number(req.body?.count) || 1, max)); const result = await rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: task.meta, count }); res.json({ task: result }); } catch (error) { res.status(400).json({ error: error.message }); } });"
new_generate = "router.post('/tasks/:id/generate-ai', async (req, res) => { try { const { tasks, configStore: store } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); if (!task?.meta) throw new Error('任务不存在'); const hasExplicitVersions = Array.isArray(req.body?.selected_versions); const sourceVersions = hasExplicitVersions ? req.body.selected_versions : task.meta.targetVersions; const versions = normalizeTargetVersions(sourceVersions, hasExplicitVersions ? undefined : (Number(task.meta.aiCount) || 1)); if (!versions.length) throw new Error('请至少选择一个文案版本'); const slotMethods = versionSelection.normalizeAiSlotMethods(req.body?.ai_slot_methods || task.meta.aiSlotMethodsSnapshot); const aiIndexes = targetAiIndexes({ targetVersions: versions }); const patch = { targetVersions: versions, aiSlotMethodsSnapshot: slotMethods, aiCount: aiIndexes.length }; await tasks.updateTaskMeta(req.username, req.params.id, patch); const result = await rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: { ...task.meta, ...patch }, aiIndexes, slotMethods }); res.json({ task: result }); } catch (error) { res.status(400).json({ error: error.message }); } });"
route = replace_once(route, old_generate, new_generate, 'single task generate AI')

route_path.write_text(route, encoding='utf-8')

rewrite_path = ROOT / 'lib/novel-fetch-workshop/rewrite.js'
rewrite = rewrite_path.read_text(encoding='utf-8')
rewrite = replace_once(
    rewrite,
    "const { processConfiguredDocumentText } = require('./rules');\n",
    "const { processConfiguredDocumentText } = require('./rules');\nconst versionSelection = require('./version-selection');\n",
    'rewrite import'
)
rewrite = replace_once(
    rewrite,
    "async function generateAiVersion({ configStore, tasks, username, task, aiIndex, count, ai } = {}) {",
    "async function generateAiVersion({ configStore, tasks, username, task, aiIndex, count, slotMethods, ai } = {}) {",
    'generateAiVersion signature'
)
rewrite = replace_once(
    rewrite,
    "  const strategy = methodForAiIndex(rewriteConfig.method_sequence, aiIndex, rewriteConfig.ai_slot_methods);",
    "  const strategy = methodForAiIndex(\n    rewriteConfig.method_sequence,\n    aiIndex,\n    versionSelection.normalizeAiSlotMethods(slotMethods || task?.aiSlotMethodsSnapshot || task?.ai_slot_methods_snapshot || rewriteConfig.ai_slot_methods)\n  );",
    'per-slot rewrite strategy'
)

old_failure_patch = """    const prevStatus = (current && current.meta && current.meta.aiStatus) || '';\n    const prevCount = (current && current.meta && Number(current.meta.aiGeneratedCount)) || 0;\n    const aiStatus = (prevStatus === 'done' || prevStatus === 'partial') ? 'partial' : 'failed';\n    await tasks.updateTaskMeta(username, bookId, {\n      aiStatus,\n      aiGeneratedCount: Math.max(prevCount, aiIndex),\n      aiError: message\n    });"""
new_failure_patch = """    const prevStatus = (current && current.meta && current.meta.aiStatus) || '';\n    const prevCount = (current && current.meta && Number(current.meta.aiGeneratedCount)) || 0;\n    const completedVersions = versionSelection.generatedVersions(current?.meta || task);\n    const aiStatus = (prevStatus === 'done' || prevStatus === 'partial') ? 'partial' : 'failed';\n    await tasks.updateTaskMeta(username, bookId, {\n      aiStatus,\n      aiGeneratedCount: prevCount,\n      aiGeneratedVersions: completedVersions,\n      aiError: message\n    });"""
if rewrite.count(old_failure_patch) != 2:
    raise SystemExit(f"rewrite failure metadata: expected 2 matches, got {rewrite.count(old_failure_patch)}")
rewrite = rewrite.replace(old_failure_patch, new_failure_patch)

rewrite = replace_once(
    rewrite,
    "  const prevCount = (current && current.meta && Number(current.meta.aiGeneratedCount)) || 0;\n  const deleteCount =",
    "  const prevCount = (current && current.meta && Number(current.meta.aiGeneratedCount)) || 0;\n  const completedVersions = versionSelection.generatedVersions(current?.meta || task);\n  const currentVersion = `ai${aiIndex}`;\n  const aiGeneratedVersions = versionSelection.normalizeSelectedVersions([...completedVersions, currentVersion], []).filter(version => version !== 'original');\n  const deleteCount =",
    'success generated version metadata'
)
rewrite = replace_once(
    rewrite,
    "    aiGeneratedCount: Math.max(prevCount, aiIndex),\n    aiError: '', // 清空旧的失败记录",
    "    aiGeneratedCount: Math.max(prevCount, aiIndex),\n    aiGeneratedVersions,\n    aiError: '', // 清空旧的失败记录",
    'success metadata update'
)

new_multi = r'''async function generateAiVersions({ configStore, tasks, username, task, aiIndexes, versions, count, slotMethods, ai } = {}) {
  const explicitVersions = Array.isArray(versions)
    ? versions
    : (Array.isArray(task?.targetVersions) ? task.targetVersions
      : (Array.isArray(task?.selectedVersions) ? task.selectedVersions : null));
  let selectedIndexes = Array.isArray(aiIndexes)
    ? [...new Set(aiIndexes.map(value => Math.floor(Number(value))).filter(value => value >= 1 && value <= 5))].sort((a, b) => a - b)
    : [];
  if (!selectedIndexes.length && explicitVersions) selectedIndexes = versionSelection.selectedAiIndices(explicitVersions);
  if (!selectedIndexes.length && !explicitVersions && Number(count) > 0) {
    const legacyCount = Math.max(0, Math.min(Math.floor(Number(count)), 5));
    selectedIndexes = Array.from({ length: legacyCount }, (_, index) => index + 1);
  }
  if (!selectedIndexes.length && !explicitVersions) {
    const legacyCount = Math.max(0, Math.min(Math.floor(Number(task?.aiCount || task?.ai_count || 1)), 5));
    selectedIndexes = Array.from({ length: legacyCount }, (_, index) => index + 1);
  }

  const generated = [];
  if (!selectedIndexes.length) return { status: 'done', generated, error: '' };

  let successCount = 0;
  let failCount = 0;
  let lastError = '';
  for (const aiIndex of selectedIndexes) {
    const r = await generateAiVersion({ configStore, tasks, username, task, aiIndex, count: selectedIndexes.length, slotMethods, ai });
    generated.push({ ...r, aiIndex, version: `ai${aiIndex}` });
    if (r.status === 'done') {
      successCount++;
    } else if (r.status === 'failed') {
      failCount++;
      if (r.error) lastError = r.error;
    } else {
      return { status: r.status, generated, error: lastError };
    }
  }

  let status;
  if (successCount > 0 && failCount === 0) status = 'done';
  else if (successCount === 0) status = 'failed';
  else status = 'partial';
  return { status, generated, error: lastError };
}

'''
rewrite = sub_once(
    rewrite,
    r"async function generateAiVersions\(\{.*?\n\}\n\nmodule\.exports = \{",
    new_multi + "module.exports = {",
    'generateAiVersions sparse implementation',
    re.S
)
rewrite_path.write_text(rewrite, encoding='utf-8')

print('patched routes/batch-rewrite.js and lib/novel-fetch-workshop/rewrite.js')
