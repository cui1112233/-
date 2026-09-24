const crypto = require('node:crypto');

const BACKOFF_MS = [2000, 5000, 10000];
const LEASE_MS = 30_000;
function now() { return new Date().toISOString(); }
function clone(value) { return structuredClone(value); }
function leaseExpiresAt() { return new Date(Date.now() + LEASE_MS).toISOString(); }
function interactiveFingerprint(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const text = String(source.input_text || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  const platform = String(source.platform_id || source.platformId || '').trim();
  const versions = Array.isArray(source.target_versions)
    ? source.target_versions
    : (Array.isArray(source.selected_versions) ? source.selected_versions : []);
  return JSON.stringify({ text, platform, versions: versions.map(value => String(value || '').trim()).filter(Boolean).sort() });
}
function payloadBookIds(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const explicit = Array.isArray(source.task_ids) ? source.task_ids : (Array.isArray(source.taskIds) ? source.taskIds : []);
  const fromInput = String(source.input_text || '').match(/\d{10,25}/g) || [];
  return new Set([...explicit, ...fromInput].map(value => String(value || '').trim()).filter(Boolean));
}

function createNovelFetchQueue({ store, execute, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.replace !== 'function') throw new Error('queue store is required');
  if (typeof execute !== 'function') throw new Error('queue execute is required');
  const running = new Map();
  const initialized = new Set();

  function ensure(owner) {
    if (!initialized.has(owner)) {
      const recovered = store.load(owner);
      initialized.add(owner);
      // queue-store changes interrupted work back to queued during restart
      // recovery. Resume it immediately on the first owner access; otherwise
      // the persisted item appears active in the UI but has no executor.
      if (recovered.state === 'idle' && recovered.items.some(item => item.state === 'queued')) {
        recovered.state = 'running';
        event(recovered, 'resumed_after_restart');
        save(owner, recovered);
        void kick(owner);
      }
    }
    return store.read(owner);
  }
  function save(owner, state) { return store.replace(owner, state); }
  function event(state, type, extra = {}) { state.events = [...(state.events || []), { type, at: now(), ...extra }].slice(-200); }
  function markPendingStopped(state) {
    state.items = state.items.map(item => ['queued', 'waiting_retry'].includes(item.state) ? { ...item, state: 'stopped', stoppedAt: now() } : item);
  }
  function isStopRequested(owner) { return ensure(owner).state === 'stopping'; }
  function isBookStopRequested(owner, bookId) {
    return (ensure(owner).stopRequestedBookIds || []).includes(String(bookId || '').trim());
  }
  function clearBookStopRequests(state, payload) {
    const completedBookIds = payloadBookIds(payload);
    if (!completedBookIds.size) return;
    state.stopRequestedBookIds = (state.stopRequestedBookIds || []).filter(bookId => !completedBookIds.has(bookId));
  }

  async function runLoop(owner) {
    for (;;) {
      let state = ensure(owner);
      if (state.state === 'paused') return;
      if (state.state === 'stopping') {
        markPendingStopped(state);
        state.state = 'idle';
        event(state, 'stopped');
        save(owner, state);
        return;
      }
      const item = state.items.find(entry => entry.state === 'queued');
      if (!item) {
        state.activeItemId = '';
        state.currentStage = '';
        state.state = 'idle';
        event(state, 'idle');
        save(owner, state);
        return;
      }

      item.state = 'running';
      item.attempts = Math.max(0, Number(item.attempts) || 0) + 1;
      item.startedAt = now();
      item.leaseExpiresAt = leaseExpiresAt();
      item.error = '';
      state.activeItemId = item.id;
      state.currentStage = 'starting';
      state.lastEvent = { stage: 'starting', itemId: item.id, at: now() };
      save(owner, state);
      try {
        const control = {
          shouldStop: bookId => isStopRequested(owner) || isBookStopRequested(owner, bookId),
          report: eventValue => {
            const currentState = ensure(owner);
            const progress = eventValue && typeof eventValue === 'object' ? { ...eventValue } : { message: String(eventValue || '') };
            currentState.activeItemId = item.id;
            currentState.currentStage = String(progress.stage || progress.type || 'processing');
            currentState.lastEvent = { ...progress, itemId: item.id, at: now() };
            const active = currentState.items.find(entry => entry.id === item.id);
            if (active?.state === 'running') {
              active.leaseExpiresAt = leaseExpiresAt();
              const record = {
                book_id: String(progress.book_id || ''),
                stage: String(progress.stage || progress.type || 'processing'),
                status: String(progress.status || ''),
                message: String(progress.message || ''),
                at: now()
              };
              active.progress = [...(active.progress || []), record].slice(-120);
            }
            event(currentState, 'progress', { itemId: item.id, stage: currentState.currentStage, message: progress.message || '' });
            save(owner, currentState);
          }
        };
        const result = await execute({
          ...clone(item),
          owner,
          isStopRequested: control.shouldStop
        }, control);
        state = store.read(owner);
        const current = state.items.find(entry => entry.id === item.id);
        const stopped = state.state === 'stopping';
        if (current) {
          current.state = stopped ? 'stopped' : 'done';
          current.result = result;
          current.completedAt = now();
          current.error = '';
          if (stopped) current.stoppedAt = current.completedAt;
          clearBookStopRequests(state, current.payload);
        }
        event(state, stopped ? 'item_stopped' : 'item_done', { itemId: item.id, attempts: item.attempts });
        if (stopped) {
          markPendingStopped(state);
          state.state = 'idle';
          event(state, 'stopped');
          save(owner, state);
          return;
        }
        if (state.state === 'paused') { save(owner, state); return; }
        state.state = 'running';
        save(owner, state);
      } catch (error) {
        state = store.read(owner);
        const current = state.items.find(entry => entry.id === item.id);
        if (!current) continue;
        const recoverable = error?.recoverable !== false;
        const maxAttempts = Math.max(1, Math.min(Number(current.maxAttempts) || 3, 10));
        current.error = error?.message || String(error);
        if (recoverable && current.attempts < maxAttempts && state.state !== 'stopping') {
          const delay = BACKOFF_MS[Math.min(current.attempts - 1, BACKOFF_MS.length - 1)];
          current.state = 'waiting_retry';
          current.nextRetryAt = new Date(Date.now() + delay).toISOString();
          event(state, 'waiting_retry', { itemId: item.id, attempts: current.attempts, delayMs: delay });
          save(owner, state);
          await sleep(delay);
          state = store.read(owner);
          const after = state.items.find(entry => entry.id === item.id);
          if (!after) continue;
          if (state.state === 'stopping') {
            after.state = 'stopped';
            after.stoppedAt = now();
            markPendingStopped(state);
            state.state = 'idle';
            event(state, 'stopped');
            save(owner, state);
            return;
          }
          after.state = 'queued';
          after.nextRetryAt = '';
          if (state.state === 'paused') { save(owner, state); return; }
          state.state = 'running';
          save(owner, state);
        } else {
          current.state = state.state === 'stopping' ? 'stopped' : 'failed';
          current.completedAt = now();
          if (current.state === 'stopped') current.stoppedAt = current.completedAt;
          event(state, current.state === 'failed' ? 'item_failed' : 'item_stopped', { itemId: item.id, attempts: current.attempts, error: current.error });
          if (state.state === 'stopping') {
            markPendingStopped(state);
            state.state = 'idle';
            event(state, 'stopped');
            save(owner, state);
            return;
          }
          if (state.state === 'paused') { save(owner, state); return; }
          state.state = 'running';
          save(owner, state);
        }
      }
    }
  }

  function kick(owner) {
    const active = running.get(owner);
    if (active) return active;
    const promise = runLoop(owner).finally(() => { if (running.get(owner) === promise) running.delete(owner); });
    running.set(owner, promise);
    return promise;
  }

  function start(owner, payloads = [], { priority = '' } = {}) {
    const state = ensure(owner);
    const activeRetryKeys = new Set(state.items
      .filter(item => ['queued', 'waiting_retry', 'running'].includes(item.state))
      .map(item => String(item?.payload?.retry_idempotency_key || '').trim())
      .filter(Boolean));
    let accepted = 0;
    let deduplicated = 0;
    let promoted = 0;
    const itemIds = [];
    for (const payload of Array.isArray(payloads) ? payloads : []) {
      const retryKey = String(payload?.retry_idempotency_key || '').trim();
      if (retryKey && activeRetryKeys.has(retryKey)) {
        deduplicated += 1;
        continue;
      }
      const fingerprint = priority === 'interactive' ? interactiveFingerprint(payload) : '';
      const existing = fingerprint
        ? state.items.find(item => item.state === 'queued' && interactiveFingerprint(item.payload) === fingerprint)
        : null;
      if (existing) {
        const from = state.items.indexOf(existing);
        state.items.splice(from, 1);
        const firstQueued = state.items.findIndex(item => item.state === 'queued');
        state.items.splice(firstQueued < 0 ? state.items.length : firstQueued, 0, existing);
        itemIds.push(existing.id);
        deduplicated += 1;
        promoted += 1;
        continue;
      }
      const item = { id: crypto.randomUUID(), state: 'queued', payload: clone(payload), attempts: 0, maxAttempts: 3, createdAt: now() };
      if (priority === 'interactive') {
        const firstQueued = state.items.findIndex(entry => entry.state === 'queued');
        state.items.splice(firstQueued < 0 ? state.items.length : firstQueued, 0, item);
      } else {
        state.items.push(item);
      }
      itemIds.push(item.id);
      if (retryKey) activeRetryKeys.add(retryKey);
      accepted += 1;
    }
    state.state = 'running';
    event(state, 'started', { added: accepted, deduplicated, promoted, priority });
    save(owner, state);
    kick(owner);
    return { ...status(owner), accepted, deduplicated, promoted, itemIds };
  }
  function pause(owner) {
    const state = ensure(owner);
    if (state.state === 'running') {
      state.state = 'paused';
      event(state, 'paused');
      save(owner, state);
    }
    return status(owner);
  }
  function resume(owner) {
    const state = ensure(owner);
    if (state.state === 'paused' || state.state === 'idle') {
      state.state = 'running';
      event(state, 'resumed');
      save(owner, state);
      kick(owner);
    }
    return status(owner);
  }
  function stop(owner) {
    const state = ensure(owner);
    const hasRunning = state.items.some(item => item.state === 'running' || item.state === 'waiting_retry');
    if (hasRunning || running.has(owner)) {
      state.state = 'stopping';
      event(state, 'stop_requested');
      save(owner, state);
    } else {
      markPendingStopped(state);
      state.state = 'idle';
      event(state, 'stopped');
      save(owner, state);
    }
    return status(owner);
  }
  function cancelBooks(owner, bookIds = []) {
    const wanted = new Set((Array.isArray(bookIds) ? bookIds : [bookIds]).map(value => String(value || '').trim()).filter(Boolean));
    const state = ensure(owner);
    const cancelledItemIds = [];
    const stopRequestedBookIds = [];
    if (wanted.size) {
      for (const item of state.items) {
        const matched = [...payloadBookIds(item.payload)].some(bookId => wanted.has(bookId));
        if (!matched) continue;
        if (item.state === 'running') {
          for (const bookId of payloadBookIds(item.payload)) {
            if (wanted.has(bookId) && !(state.stopRequestedBookIds || []).includes(bookId)) stopRequestedBookIds.push(bookId);
          }
          continue;
        }
        if (!['queued', 'waiting_retry'].includes(item.state)) continue;
        item.state = 'stopped';
        item.stoppedAt = now();
        item.error = '关联书籍已删除';
        cancelledItemIds.push(item.id);
      }
    }
    if (stopRequestedBookIds.length) {
      state.stopRequestedBookIds = [...new Set([...(state.stopRequestedBookIds || []), ...stopRequestedBookIds])];
    }
    if (cancelledItemIds.length || stopRequestedBookIds.length) {
      event(state, 'books_cancelled', { bookIds: [...wanted], itemIds: cancelledItemIds, stopRequestedBookIds });
      save(owner, state);
    }
    return { ...status(owner), cancelledItemIds, stopRequestedBookIds };
  }
  function status(owner) { return clone(ensure(owner)); }
  async function waitForIdle(owner) {
    for (;;) {
      const active = running.get(owner);
      if (active) await active;
      const state = status(owner);
      if (state.state === 'idle' || state.state === 'paused') return state;
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  return { start, pause, resume, stop, cancelBooks, isBookStopRequested, status, waitForIdle };
}

module.exports = { BACKOFF_MS, LEASE_MS, createNovelFetchQueue };
