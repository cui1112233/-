#!/usr/bin/env python3
from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 regex match, found {count}")
    return updated


# 1) Compatibility task shape: expose the same selected-version contract the browser sends.
task_ops_path = Path('lib/novel-fetch-workshop/task-ops.js')
task_ops = task_ops_path.read_text()
task_ops = replace_once(
    task_ops,
    "const { normalizeTargetVersions, hasExplicitTargetVersions } = require('./target-versions');\n",
    "const { normalizeTargetVersions, hasExplicitTargetVersions } = require('./target-versions');\nconst { normalizeAiSlotMethods } = require('./version-selection');\n",
    'task-ops import'
)
task_ops = replace_once(
    task_ops,
    "  const legacyAiCount = Number(task.aiCount || task.ai_count) || 1;\n  const legacyGenerated = Number(task.aiGeneratedCount || task.ai_generated_count) || 0;",
    "  const legacyAiCount = Number(task.aiCount || task.ai_count) || 1;\n  const selectedVersions = explicitTargets || normalizeTargetVersions(undefined, legacyAiCount);\n  const slotMethods = normalizeAiSlotMethods(\n    task.aiSlotMethodsSnapshot || task.ai_slot_methods_snapshot || task.aiSlotMethods || task.ai_slot_methods\n  );\n  const legacyGenerated = Number(task.aiGeneratedCount || task.ai_generated_count) || 0;",
    'task-ops selected versions'
)
task_ops = replace_once(
    task_ops,
    "    ai_count: targetAi ? targetAi.length : legacyAiCount,\n    ai_files: aiFiles,",
    "    ai_count: targetAi ? targetAi.length : legacyAiCount,\n    selected_versions: selectedVersions,\n    ai_slot_methods: slotMethods,\n    ai_files: aiFiles,",
    'task-ops public aliases'
)
task_ops_path.write_text(task_ops)

# 2) Batch Rewrite compatibility route: consume the browser's explicit sparse-version contract.
route_path = Path('routes/batch-rewrite.js')
route = route_path.read_text()
route = replace_once(
    route,
    "const rewrite = require('../lib/novel-fetch-workshop/rewrite');\n",
    "const rewrite = require('../lib/novel-fetch-workshop/rewrite');\nconst versionSelection = require('../lib/novel-fetch-workshop/version-selection');\n",
    'route import'
)
route = regex_once(
    route,
    r"function snakeTask\(task = \{\}\) \{.*?\n\}\n\nfunction legacyMeta",
    """function snakeTask(task = {}) {
  const bookId = task.bookId || task.book_id || task.id || '';
  const bookName = task.bookName || task.book_name || '';
  const platformId = task.platformId || task.platform_id || '';
  const platformName = task.platformName || task.platform_name || '';
  const selectedVersions = versionSelection.taskSelectedVersions(task);
  const aiFiles = versionSelection.generatedVersions(task);
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
    ai_count: selectedVersions.filter(version => /^ai[1-5]$/.test(version)).length,
    selected_versions: selectedVersions,
    ai_slot_methods: versionSelection.normalizeAiSlotMethods(task.aiSlotMethodsSnapshot || task.ai_slot_methods_snapshot || task.aiSlotMethods || task.ai_slot_methods),
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

function legacyMeta""",
    'route snakeTask'
)
route = regex_once(
    route,
    r"function normalizeProfileBindings\(value\) \{.*?\n\}",
    """function normalizeProfileBindings(value) {
  return versionSelection.normalizeProfileBindings(value);
}""",
    'route profile bindings'
)
route = regex_once(
    route,
    r"    const maxAiCount = Math\.max\(1, Math\.min\(Number\(config\.rewrite\?\.max_ai_count\) \|\| 5, 20\)\);\n    const defaultAiCount = Math\.max\(1, Math\.min\(Number\(config\.rewrite\?\.default_ai_count\) \|\| 1, maxAiCount\)\);\n    const prepared = \(parsed\.tasks \|\| \[\]\)\.map\(item => \(\{\n      \.\.\.item,\n      platformId: String\(payload\.platform_id \|\| '2'\),\n      platformName: platform\.name \|\| String\(payload\.platform_id \|\| '2'\),\n      maxTxt: Number\(payload\.max_txt\) \|\| Number\(config\.fetch\?\.default_max_txt\) \|\| 4000,\n      aiCount: Math\.max\(1, Math\.min\(Number\(payload\.ai_count\) \|\| defaultAiCount, maxAiCount\)\)\n    \}\)\);",
    """    const hasExplicitVersions = Array.isArray(payload?.selected_versions);
    const selectedVersions = versionSelection.normalizeSelectedVersions(
      payload?.selected_versions,
      hasExplicitVersions ? [] : undefined
    );
    if (!selectedVersions.length) throw new Error('请至少选择一个文案版本');
    const aiSlotMethods = versionSelection.normalizeAiSlotMethods(payload.ai_slot_methods);
    const prepared = (parsed.tasks || []).map(item => ({
      ...item,
      platformId: String(payload.platform_id || '2'),
      platformName: platform.name || String(payload.platform_id || '2'),
      maxTxt: Number(payload.max_txt) || Number(config.fetch?.default_max_txt) || 4000,
      selectedVersions,
      targetVersions: selectedVersions,
      aiSlotMethods,
      aiSlotMethodsSnapshot: aiSlotMethods,
      aiCount: selectedVersions.filter(version => /^ai[1-5]$/.test(version)).length
    }));""",
    'route process selection'
)
route = replace_once(
    route,
    "return rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: task?.meta, count: task?.meta?.aiCount || 1 });",
    "return rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: task?.meta, versions: task?.meta?.selectedVersions || task?.meta?.targetVersions, slotMethods: task?.meta?.aiSlotMethods || task?.meta?.aiSlotMethodsSnapshot });",
    'route auto rewrite'
)
route = replace_once(
    route,
    "await rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: refreshed.meta, count: task.meta.aiCount || 1 });",
    "await rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: refreshed.meta, versions: refreshed.meta.selectedVersions || refreshed.meta.targetVersions, slotMethods: refreshed.meta.aiSlotMethods || refreshed.meta.aiSlotMethodsSnapshot });",
    'route retry rewrite'
)
route = replace_once(
    route,
    "        const count = Number(task?.meta?.aiGeneratedCount) || 0;\n        for (let index = 1; index <= count; index++) if (await applySavedRulesToVersion(tasks, req.username, id, `ai${index}`, config)) applied++;",
    "        for (const version of versionSelection.generatedVersions(task?.meta || {})) {\n          if (await applySavedRulesToVersion(tasks, req.username, id, version, config)) applied++;\n        }",
    'route sparse rule versions'
)
route = regex_once(
    route,
    r"  router\.get\('/tasks/:id', async \(req, res\) => \{ try \{ const \{ tasks \} = await resources\(req\); const task = await tasks\.getTask\(req\.username, req\.params\.id\); if \(!task\?\.meta\) return res\.status\(404\)\.json\(\{ error: '任务不存在' \}\); const count = Number\(task\.meta\.aiGeneratedCount\) \|\| 0; const aiTexts = \[\]; for \(let index = 1; index <= count; index\+\+\) aiTexts\.push\(\{ name: `AI\$\{index\}`, text: await tasks\.readVersionText\(req\.username, req\.params\.id, `ai\$\{index\}`\) \}\); const sensitiveLog = await readSensitiveLog\(tasks, req\.username, req\.params\.id\); res\.json\(\{ meta: legacyMeta\(task\.meta\), original: await tasks\.readOriginal\(req\.username, req\.params\.id\), ai_texts: aiTexts, has_original_raw: task\.hasOriginalRaw === true, \.\.\.sensitiveLog, logs: await tasks\.readLogs\(req\.username, req\.params\.id\) \}\); \} catch \(error\) \{ res\.status\(400\)\.json\(\{ error: error\.message \}\); \} \}\);",
    """  router.get('/tasks/:id', async (req, res) => { try { const { tasks } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); if (!task?.meta) return res.status(404).json({ error: '任务不存在' }); const aiTexts = []; for (const version of versionSelection.generatedVersions(task.meta)) aiTexts.push({ name: version.toUpperCase(), version, text: await tasks.readVersionText(req.username, req.params.id, version) }); const sensitiveLog = await readSensitiveLog(tasks, req.username, req.params.id); res.json({ meta: legacyMeta(task.meta), original: await tasks.readOriginal(req.username, req.params.id), ai_texts: aiTexts, has_original_raw: task.hasOriginalRaw === true, ...sensitiveLog, logs: await tasks.readLogs(req.username, req.params.id) }); } catch (error) { res.status(400).json({ error: error.message }); } });""",
    'route sparse task detail'
)
route = regex_once(
    route,
    r"  router\.post\('/tasks/:id/generate-ai', async \(req, res\) => \{ try \{.*?\} catch \(error\) \{ res\.status\(400\)\.json\(\{ error: error\.message \}\); \} \}\);",
    """  router.post('/tasks/:id/generate-ai', async (req, res) => { try { const { tasks, configStore: store } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); if (!task?.meta) throw new Error('任务不存在'); const hasExplicitVersions = Array.isArray(req.body?.selected_versions); const versions = versionSelection.normalizeSelectedVersions(hasExplicitVersions ? req.body.selected_versions : (task.meta.selectedVersions || task.meta.targetVersions), hasExplicitVersions ? [] : undefined); if (!versions.length) throw new Error('请至少选择一个文案版本'); const slotMethods = versionSelection.normalizeAiSlotMethods(req.body?.ai_slot_methods || task.meta.aiSlotMethods || task.meta.aiSlotMethodsSnapshot); await tasks.updateTaskMeta(req.username, req.params.id, { selectedVersions: versions, targetVersions: versions, aiSlotMethods: slotMethods, aiSlotMethodsSnapshot: slotMethods, aiCount: versions.filter(version => /^ai[1-5]$/.test(version)).length }); const result = await rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: { ...task.meta, selectedVersions: versions, targetVersions: versions, aiSlotMethods: slotMethods }, versions, slotMethods }); res.json({ task: result }); } catch (error) { res.status(400).json({ error: error.message }); } });""",
    'route manual sparse generate'
)
route_path.write_text(route)

# 3) Rewrite engine: generate sparse AI2/AI5 without inventing AI1/AI3/AI4 and persist explicit generated versions.
rewrite_path = Path('lib/novel-fetch-workshop/rewrite.js')
rewrite = rewrite_path.read_text()
rewrite = replace_once(
    rewrite,
    "const { processConfiguredDocumentText } = require('./rules');\n",
    "const { processConfiguredDocumentText } = require('./rules');\nconst { normalizeSelectedVersions, selectedAiIndices, normalizeAiSlotMethods, generatedVersions } = require('./version-selection');\n",
    'rewrite import'
)
rewrite = replace_once(
    rewrite,
    "async function generateAiVersion({ configStore, tasks, username, task, aiIndex, count, ai } = {}) {",
    "async function generateAiVersion({ configStore, tasks, username, task, aiIndex, count, slotMethods, ai } = {}) {",
    'rewrite single signature'
)
rewrite = replace_once(
    rewrite,
    "  const strategy = methodForAiIndex(rewriteConfig.method_sequence, aiIndex, rewriteConfig.ai_slot_methods);",
    "  const strategy = methodForAiIndex(\n    rewriteConfig.method_sequence,\n    aiIndex,\n    normalizeAiSlotMethods(slotMethods || task?.aiSlotMethods || task?.ai_slot_methods || task?.aiSlotMethodsSnapshot || rewriteConfig.ai_slot_methods)\n  );",
    'rewrite task-specific method'
)
# Failure paths must not claim gaps as generated versions.
rewrite = replace_once(
    rewrite,
    "    const aiStatus = (prevStatus === 'done' || prevStatus === 'partial') ? 'partial' : 'failed';\n    await tasks.updateTaskMeta(username, bookId, {\n      aiStatus,\n      aiGeneratedCount: Math.max(prevCount, aiIndex),\n      aiError: message\n    });",
    "    const completedVersions = generatedVersions(current?.meta || task);\n    const aiStatus = (prevStatus === 'done' || prevStatus === 'partial') ? 'partial' : 'failed';\n    await tasks.updateTaskMeta(username, bookId, {\n      aiStatus,\n      aiGeneratedCount: prevCount,\n      aiGeneratedVersions: completedVersions,\n      aiError: message\n    });",
    'rewrite request failure metadata'
)
rewrite = replace_once(
    rewrite,
    "    const aiStatus = (prevStatus === 'done' || prevStatus === 'partial') ? 'partial' : 'failed';\n    await tasks.updateTaskMeta(username, bookId, {\n      aiStatus,\n      aiGeneratedCount: Math.max(prevCount, aiIndex),\n      aiError: message\n    });",
    "    const completedVersions = generatedVersions(current?.meta || task);\n    const aiStatus = (prevStatus === 'done' || prevStatus === 'partial') ? 'partial' : 'failed';\n    await tasks.updateTaskMeta(username, bookId, {\n      aiStatus,\n      aiGeneratedCount: prevCount,\n      aiGeneratedVersions: completedVersions,\n      aiError: message\n    });",
    'rewrite empty failure metadata'
)
rewrite = replace_once(
    rewrite,
    "  const prevCount = (current && current.meta && Number(current.meta.aiGeneratedCount)) || 0;\n  const deleteCount = Math.min",
    "  const prevCount = (current && current.meta && Number(current.meta.aiGeneratedCount)) || 0;\n  const completedVersions = generatedVersions(current?.meta || task);\n  const currentVersion = `ai${aiIndex}`;\n  const aiGeneratedVersions = normalizeSelectedVersions([...completedVersions, currentVersion], []).filter(version => version !== 'original');\n  const deleteCount = Math.min",
    'rewrite successful versions'
)
rewrite = replace_once(
    rewrite,
    "    aiGeneratedCount: Math.max(prevCount, aiIndex),\n    aiError: '', // 清空旧的失败记录",
    "    aiGeneratedCount: Math.max(prevCount, aiGeneratedVersions.length),\n    aiGeneratedVersions,\n    aiError: '', // 清空旧的失败记录",
    'rewrite successful metadata'
)
rewrite = regex_once(
    rewrite,
    r"async function generateAiVersions\(\{ configStore, tasks, username, task, count, ai \} = \{\}\) \{.*?\n\}\n\nmodule\.exports",
    """async function generateAiVersions({ configStore, tasks, username, task, versions, count, slotMethods, ai } = {}) {
  let aiIndices = selectedAiIndices(versions || task?.selectedVersions || task?.selected_versions || task?.targetVersions || task?.target_versions);
  if (!aiIndices.length && Number(count) > 0) {
    const legacyCount = Math.max(0, Math.min(Math.floor(Number(count)), 5));
    aiIndices = Array.from({ length: legacyCount }, (_, index) => index + 1);
  }
  const generated = [];
  if (!aiIndices.length) return { status: 'done', generated, error: '' };

  let successCount = 0;
  let failCount = 0;
  let lastError = '';
  for (const aiIndex of aiIndices) {
    const r = await generateAiVersion({ configStore, tasks, username, task, aiIndex, count: aiIndices.length, slotMethods, ai });
    generated.push({ ...r, version: `ai${aiIndex}` });
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

module.exports""",
    'rewrite sparse orchestrator'
)
rewrite_path.write_text(rewrite)

print('Applied minimal V88 six-version backend contract patch.')
