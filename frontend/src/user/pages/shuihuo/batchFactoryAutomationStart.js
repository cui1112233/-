function automationState(result) {
  return String(result?.automation?.state || result?.state || 'idle');
}

export async function ensureBatchAutomationStarted(batchId, {
  getStatus,
  listPresets,
  start,
  runMode = 'full_submit',
  autoPublish = true,
  concurrency = 2
} = {}) {
  if (!batchId || typeof getStatus !== 'function' || typeof listPresets !== 'function' || typeof start !== 'function') {
    throw new Error('批量自动化启动参数不完整');
  }
  const status = await getStatus(batchId);
  if (['running', 'scheduled'].includes(automationState(status))) return { started: false, reason: 'active' };

  const presetResult = await listPresets();
  const presets = Array.isArray(presetResult) ? presetResult : (Array.isArray(presetResult?.presets) ? presetResult.presets : []);
  const preset = presets.find(item => item?.id);
  if (!preset?.id) throw new Error('请先配置自动化预设');

  const result = await start(batchId, {
    presetId: preset.id,
    runMode,
    autoPublish: autoPublish === true,
    concurrency
  });
  return { started: true, result };
}
