const crypto = require('node:crypto');

async function writeModelAudit(tasks, { bookId, stage, settings, status, attempts, errorMessage = '' } = {}) {
  if (typeof tasks?.writeRunAudit !== 'function' || !settings?.textModelId) return;
  try {
    await tasks.writeRunAudit({
      runId: crypto.randomUUID(), bookId, stage, status, attempts,
      textModelId: settings.textModelId, modelId: settings.textModelId,
      modelDisplayName: settings.modelDisplayName || settings.model || '', errorMessage,
      finishedAt: new Date().toISOString()
    });
  } catch (_) { /* audit is observational and must not break completed work */ }
}

async function writeStageAudits(tasks, rows, options) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const bookId = String(row?.bookId || '').trim();
    if (!bookId) continue;
    await writeModelAudit(tasks, { bookId, ...options });
  }
}

module.exports = { writeModelAudit, writeStageAudits };
