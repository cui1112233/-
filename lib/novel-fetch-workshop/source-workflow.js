'use strict';

const SOURCE_STATES = Object.freeze({
  SUBMITTED_TO_SOURCE: 'submitted_to_source',
  ACCEPTED: 'accepted',
  QUEUED: 'queued',
  RUNNING: 'running',
  RESULT_READY: 'result_ready',
  DOWNLOADED: 'downloaded',
  SAVED: 'saved',
  COMPLETED: 'completed',
  ACCEPTED_PENDING: 'accepted_pending',
  FAILED: 'failed'
});

const SOURCE_CODES = Object.freeze({
  SUBMIT_REJECTED: 'SOURCE_SUBMIT_REJECTED',
  PROTOCOL_ERROR: 'SOURCE_PROTOCOL_ERROR',
  AUTH_EXPIRED: 'SOURCE_AUTH_EXPIRED',
  EXTERNAL_BLOCKED: 'SOURCE_EXTERNAL_BLOCKED',
  TASK_TIMEOUT: 'SOURCE_TASK_TIMEOUT',
  TASK_FAILED: 'SOURCE_TASK_FAILED',
  RESULT_EMPTY: 'SOURCE_RESULT_EMPTY',
  RESULT_DOWNLOAD_FAILED: 'SOURCE_RESULT_DOWNLOAD_FAILED',
  SAVE_FAILED: 'SOURCE_SAVE_FAILED'
});

function text(value) { return String(value == null ? '' : value).trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

function failed(code, message, remoteTaskId = '', history = []) {
  return {
    status: 'failed',
    sourceStatus: SOURCE_STATES.FAILED,
    errorCode: code,
    message: text(message),
    remoteTaskId: text(remoteTaskId),
    history: history.slice()
  };
}

function pending(code, message, remoteTaskId, history) {
  return {
    status: SOURCE_STATES.ACCEPTED_PENDING,
    sourceStatus: SOURCE_STATES.ACCEPTED_PENDING,
    errorCode: code,
    message: text(message),
    remoteTaskId: text(remoteTaskId),
    history: [...history, SOURCE_STATES.ACCEPTED_PENDING]
  };
}

function thrownCode(error, fallback) {
  const code = text(error?.code);
  return Object.values(SOURCE_CODES).includes(code) ? code : fallback;
}

async function runSourceWorkflow({
  bookId,
  platformId,
  maxTxt,
  adapters = {},
  maxPollAttempts = 10,
  pollIntervalMs = 1000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  const source = object(adapters);
  const history = [];
  if (typeof source.submit !== 'function') {
    return failed(SOURCE_CODES.PROTOCOL_ERROR, 'source submit adapter is not configured');
  }

  let submitted;
  try {
    submitted = object(await source.submit({ bookId: text(bookId), platformId: text(platformId), maxTxt: Number(maxTxt) || 0 }));
  } catch (error) {
    return failed(thrownCode(error, SOURCE_CODES.EXTERNAL_BLOCKED), error?.message || 'source submit is unavailable');
  }

  if (submitted.outcome === 'rejected') {
    return failed(SOURCE_CODES.SUBMIT_REJECTED, submitted.message || 'source rejected the task');
  }
  if (submitted.outcome === 'auth_expired') {
    return failed(SOURCE_CODES.AUTH_EXPIRED, submitted.message || 'source session expired');
  }
  if (submitted.outcome === 'external_blocked') {
    return failed(SOURCE_CODES.EXTERNAL_BLOCKED, submitted.message || 'source submit is unavailable');
  }
  if (submitted.outcome !== 'accepted') {
    return failed(SOURCE_CODES.PROTOCOL_ERROR, submitted.message || 'source submit response is not explicitly accepted');
  }

  const remoteTaskId = text(submitted.remoteTaskId);
  if (!remoteTaskId) {
    return failed(SOURCE_CODES.PROTOCOL_ERROR, 'source accepted response has no remote task id');
  }
  history.push(SOURCE_STATES.SUBMITTED_TO_SOURCE, SOURCE_STATES.ACCEPTED);

  if (typeof source.poll !== 'function') {
    return pending(SOURCE_CODES.PROTOCOL_ERROR, 'source poll adapter is not configured', remoteTaskId, history);
  }

  const pollLimit = Math.max(1, Math.floor(Number(maxPollAttempts) || 1));
  let ready = false;
  for (let attempt = 0; attempt < pollLimit; attempt += 1) {
    let polled;
    try {
      polled = object(await source.poll({ remoteTaskId, bookId: text(bookId), attempt: attempt + 1 }));
    } catch (error) {
      return pending(thrownCode(error, SOURCE_CODES.EXTERNAL_BLOCKED), error?.message || 'source poll is unavailable', remoteTaskId, history);
    }

    if (polled.outcome === 'queued') {
      history.push(SOURCE_STATES.QUEUED);
    } else if (polled.outcome === 'running') {
      history.push(SOURCE_STATES.RUNNING);
    } else if (polled.outcome === 'result_ready') {
      history.push(SOURCE_STATES.RESULT_READY);
      ready = true;
      break;
    } else if (polled.outcome === 'failed') {
      return failed(SOURCE_CODES.TASK_FAILED, polled.message || 'source task failed', remoteTaskId, history);
    } else if (polled.outcome === 'auth_expired') {
      return pending(SOURCE_CODES.AUTH_EXPIRED, polled.message || 'source session expired while polling', remoteTaskId, history);
    } else if (polled.outcome === 'external_blocked') {
      return pending(SOURCE_CODES.EXTERNAL_BLOCKED, polled.message || 'source poll is unavailable', remoteTaskId, history);
    } else {
      return pending(SOURCE_CODES.PROTOCOL_ERROR, polled.message || 'source poll returned an unknown state', remoteTaskId, history);
    }

    if (attempt + 1 < pollLimit) await sleep(Math.max(0, Number(pollIntervalMs) || 0));
  }

  if (!ready) {
    return pending(SOURCE_CODES.TASK_TIMEOUT, 'source task has not reached result_ready', remoteTaskId, history);
  }

  if (typeof source.result !== 'function') {
    return pending(SOURCE_CODES.PROTOCOL_ERROR, 'source result adapter is not configured', remoteTaskId, history);
  }

  let result;
  try {
    result = object(await source.result({ remoteTaskId, bookId: text(bookId) }));
  } catch (error) {
    return pending(thrownCode(error, SOURCE_CODES.EXTERNAL_BLOCKED), error?.message || 'source result is unavailable', remoteTaskId, history);
  }
  if (result.outcome === 'auth_expired') {
    return pending(SOURCE_CODES.AUTH_EXPIRED, result.message || 'source session expired while reading result', remoteTaskId, history);
  }
  if (result.outcome === 'external_blocked') {
    return pending(SOURCE_CODES.EXTERNAL_BLOCKED, result.message || 'source result is unavailable', remoteTaskId, history);
  }
  if (result.outcome === 'failed') {
    return failed(SOURCE_CODES.TASK_FAILED, result.message || 'source result failed', remoteTaskId, history);
  }
  if (result.outcome !== 'result_ready') {
    return pending(SOURCE_CODES.PROTOCOL_ERROR, result.message || 'source result is not ready', remoteTaskId, history);
  }

  let body = typeof result.text === 'string' ? result.text : '';
  if (!body.trim()) {
    if (result.downloadRef == null) {
      return pending(SOURCE_CODES.RESULT_EMPTY, 'source result contains no body or download reference', remoteTaskId, history);
    }
    if (typeof source.download !== 'function') {
      return pending(SOURCE_CODES.RESULT_DOWNLOAD_FAILED, 'source download adapter is not configured', remoteTaskId, history);
    }
    let downloaded;
    try {
      downloaded = object(await source.download({ remoteTaskId, bookId: text(bookId), downloadRef: result.downloadRef }));
    } catch (error) {
      return pending(thrownCode(error, SOURCE_CODES.RESULT_DOWNLOAD_FAILED), error?.message || 'source result download failed', remoteTaskId, history);
    }
    if (downloaded.outcome === 'auth_expired') {
      return pending(SOURCE_CODES.AUTH_EXPIRED, downloaded.message || 'source session expired while downloading result', remoteTaskId, history);
    }
    if (downloaded.outcome === 'external_blocked') {
      return pending(SOURCE_CODES.EXTERNAL_BLOCKED, downloaded.message || 'source result download is unavailable', remoteTaskId, history);
    }
    if (downloaded.outcome !== 'downloaded') {
      return pending(SOURCE_CODES.RESULT_DOWNLOAD_FAILED, downloaded.message || 'source result download failed', remoteTaskId, history);
    }
    body = typeof downloaded.text === 'string' ? downloaded.text : '';
  }

  if (!body.trim()) {
    return pending(SOURCE_CODES.RESULT_EMPTY, 'source result body is empty', remoteTaskId, history);
  }
  history.push(SOURCE_STATES.DOWNLOADED);

  if (typeof source.save !== 'function') {
    return failed(SOURCE_CODES.SAVE_FAILED, 'source save adapter is not configured', remoteTaskId, history);
  }
  let saved;
  try {
    saved = object(await source.save({ remoteTaskId, bookId: text(bookId), platformId: text(platformId), maxTxt: Number(maxTxt) || 0, text: body }));
  } catch (error) {
    return failed(thrownCode(error, SOURCE_CODES.SAVE_FAILED), error?.message || 'source result save failed', remoteTaskId, history);
  }
  if (saved.outcome !== 'saved' || saved.verified !== true) {
    return failed(SOURCE_CODES.SAVE_FAILED, saved.message || 'source result save was not verified', remoteTaskId, history);
  }

  history.push(SOURCE_STATES.SAVED, SOURCE_STATES.COMPLETED);
  return {
    status: 'done',
    sourceStatus: SOURCE_STATES.COMPLETED,
    errorCode: '',
    message: '',
    remoteTaskId,
    history
  };
}

function createSourceFetchOriginal({ adapters, maxPollAttempts, pollIntervalMs, sleep } = {}) {
  const configuredAdapters = object(adapters);
  const sourceConfigured = Object.keys(configuredAdapters).length > 0;

  return async function sourceFetchOriginal(owner, request = {}) {
    const tasks = request.tasks;
    const bookId = text(request.bookId || request.task?.bookId || request.task?.book_id || request.task?.id);
    const maxTxt = Number(request.maxTxt ?? request.task?.maxTxt) || 0;
    const fallback = typeof request.fallbackFetchOriginal === 'function'
      ? request.fallbackFetchOriginal
      : (typeof tasks?.fetchOriginal === 'function' ? tasks.fetchOriginal.bind(tasks) : null);

    if (!sourceConfigured) {
      if (typeof fallback !== 'function') return failed(SOURCE_CODES.PROTOCOL_ERROR, 'verified source adapter is not configured');
      return fallback(owner, bookId, maxTxt);
    }

    let task = request.task || null;
    if (!task && typeof tasks?.getTask === 'function') task = await tasks.getTask(owner, bookId);
    const meta = object(task?.meta || task?.document?.meta || task);
    const platformId = text(request.platformId || meta.platformId || meta.platform_id);
    const workflowResult = await runSourceWorkflow({
      bookId,
      platformId,
      maxTxt,
      adapters: configuredAdapters,
      maxPollAttempts,
      pollIntervalMs,
      sleep
    });

    if (typeof tasks?.updateTaskMeta === 'function' && bookId) {
      await tasks.updateTaskMeta(owner, bookId, {
        sourceFetchStatus: workflowResult.sourceStatus,
        sourceFetchErrorCode: workflowResult.errorCode || '',
        sourceRemoteTaskId: workflowResult.remoteTaskId || ''
      });
    }
    if (typeof tasks?.appendLog === 'function' && bookId) {
      await tasks.appendLog(owner, bookId, 'source_fetch_workflow', {
        status: workflowResult.sourceStatus,
        errorCode: workflowResult.errorCode || '',
        remoteTaskId: workflowResult.remoteTaskId || '',
        history: workflowResult.history || []
      });
    }
    return workflowResult;
  };
}

module.exports = { SOURCE_STATES, SOURCE_CODES, runSourceWorkflow, createSourceFetchOriginal };
