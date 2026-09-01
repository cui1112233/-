'use strict';

const { targetAiIndexes, hasExplicitTargetVersions } = require('./target-versions');
const { generateAiVersion: defaultGenerateAiVersion } = require('./rewrite');

function nonEmpty(value) { return String(value == null ? '' : value).trim() !== ''; }

async function generatedVersions(tasks, username, task, indexes) {
  const done = [];
  for (const index of indexes) {
    const version = `ai${index}`;
    const text = typeof tasks?.readVersionText === 'function'
      ? await tasks.readVersionText(username, task?.bookId, version)
      : '';
    if (nonEmpty(text)) done.push(version);
  }
  return done;
}

function statusFromResults(results, doneCount, targetCount) {
  if (results.some(item => item.status === 'cancelled')) return 'cancelled';
  if (targetCount === 0) return 'done';
  const blocking = results.find(item => ['waiting_original', 'waiting_ai_config'].includes(item.status));
  if (blocking) return blocking.status;
  const failed = results.filter(item => item.status === 'failed').length;
  if (doneCount >= targetCount && failed === 0) return 'done';
  if (doneCount > 0) return 'partial';
  return failed ? 'failed' : 'partial';
}

async function cancellationRequested(tasks, username, task, shouldStop) {
  if (typeof shouldStop === 'function' && shouldStop()) return true;
  if (typeof tasks?.getTask !== 'function' || !task?.bookId) return false;
  const current = await tasks.getTask(username, task.bookId);
  return Boolean(current?.meta?.cancelRequestedAt || current?.meta?.status === 'cancelled');
}

function createTargetAwareAiGenerator({ generateAiVersion = defaultGenerateAiVersion } = {}) {
  if (typeof generateAiVersion !== 'function') throw new Error('generateAiVersion is required');

  return async function generateTargetAiVersions({ configStore, tasks, username, task, count, ai, shouldStop } = {}) {
    const explicit = hasExplicitTargetVersions(task);
    if (!explicit) {
      const legacyCount = Math.max(0, Math.floor(Number(count ?? task?.aiCount) || 0));
      const indexes = Array.from({ length: legacyCount }, (_, index) => index + 1);
      return runIndexes({ indexes, configStore, tasks, username, task, ai, explicit: false, shouldStop });
    }
    const indexes = targetAiIndexes(task);
    return runIndexes({ indexes, configStore, tasks, username, task, ai, explicit: true, shouldStop });
  };

  async function runIndexes({ indexes, configStore, tasks, username, task, ai, explicit, shouldStop }) {
    const generated = [];
    const initialDone = await generatedVersions(tasks, username, task, indexes);
    const completed = new Set(initialDone);

    for (const aiIndex of indexes) {
      const version = `ai${aiIndex}`;
      if (completed.has(version)) {
        generated.push({ status: 'done', version, aiIndex, skipped: true, reason: 'existing_artifact', versionText: '', error: '' });
        continue;
      }
      // Soft stop: do not start a new slot after a stop request. A slot already inside generateAiVersion
      // is allowed to finish and save before this check is reached for the next slot.
      if (await cancellationRequested(tasks, username, task, shouldStop)) {
        generated.push({ status: 'cancelled', version, aiIndex, skipped: true, reason: 'stop_requested', versionText: '', error: '' });
        break;
      }
      const result = await generateAiVersion({
        configStore,
        tasks,
        username,
        task,
        aiIndex,
        count: indexes.length,
        ai
      });
      generated.push({ ...result, version, aiIndex, skipped: false });
      if (result?.status === 'done') completed.add(version);
      if (['waiting_original', 'waiting_ai_config'].includes(result?.status)) break;
    }

    const finalDone = await generatedVersions(tasks, username, task, indexes);
    const status = statusFromResults(generated, finalDone.length, indexes.length);
    if (typeof tasks?.updateTaskMeta === 'function' && task?.bookId) {
      const timestamp = status === 'cancelled' ? new Date().toISOString() : '';
      await tasks.updateTaskMeta(username, task.bookId, {
        ...(explicit ? { targetVersions: Array.isArray(task.targetVersions) ? task.targetVersions : [] } : {}),
        aiGeneratedVersions: finalDone,
        aiGeneratedCount: finalDone.length,
        aiStatus: status,
        ...(status === 'cancelled' ? { status: 'cancelled', cancelledAt: timestamp } : {}),
        ...(status === 'done' ? { aiError: '' } : {})
      });
    }
    return {
      status,
      generated,
      generatedVersions: finalDone,
      error: generated.filter(item => item?.error).map(item => item.error).at(-1) || ''
    };
  }
}

module.exports = { generatedVersions, statusFromResults, cancellationRequested, createTargetAwareAiGenerator };
