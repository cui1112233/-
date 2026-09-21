const crypto = require('node:crypto');

async function writeModelAudit(tasks, { bookId, stage, settings, status, attempts, errorMessage = '' } = {}) {
  if (typeof tasks?.writeRunAudit !== 'function' || !settings?.textModelId) return;
  try {
    await tasks.writeRunAudit({ runId: crypto.randomUUID(), bookId, stage, status, attempts,
      textModelId: settings.textModelId, modelId: settings.textModelId,
      modelDisplayName: settings.modelDisplayName || settings.model || '', errorMessage,
      finishedAt: new Date().toISOString() });
  } catch (_) { /* audit must not break completed work */ }
}

module.exports = { writeModelAudit };
