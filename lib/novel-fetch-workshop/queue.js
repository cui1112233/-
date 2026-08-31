const crypto = require('node:crypto');

const BACKOFF_MS = [2000, 5000, 10000];
function now() { return new Date().toISOString(); }
function clone(value) { return structuredClone(value); }

function createNovelFetchQueue({ store, execute, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.replace !== 'function') throw new Error('queue store is required');
  if (typeof execute !== 'function') throw new Error('queue execute is required');
  const running = new Map();
  const initialized = new Set();

  function ensure(owner) {
    if (!initialized.has(owner)) { store.load(owner); initialized.add(owner); }
    return store.read(owner);
  }
  function save(owner, state) { return store.replace(owner, state); }
  function event(state, type, extra = {}) { state.events = [...(state.events || []), { type, at: now(), ...extra }].slice(-200); }
  function markPendingStopped(state) {
    state.items = state.items.map(item => ['queued', 'waiting_retry'].includes(item.state) ? { ...item, state: 'stopped', stoppedAt: now() } : item);
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
        state.state = 'idle';
        event(state, 'idle');
        save(owner, state);
        return;
      }

      item.state = 'running';
      item.attempts = Math.max(0, Number(item.attempts) || 0) + 1;
      item.startedAt = now();
      item.error = '';
      save(owner, state);
      try {
        const result = await execute({ ...clone(item), owner });
        state = store.read(owner);
        const current = state.items.find(entry => entry.id === item.id);
        if (current) {
          current.state = 'done';
          current.result = result;
          current.completedAt = now();
          current.error = '';
        }
        event(state, 'item_done', { itemId: item.id, attempts: item.attempts });
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

  function start(owner, payloads = []) {
    const state = ensure(owner);
    for (const payload of Array.isArray(payloads) ? payloads : []) {
      state.items.push({ id: crypto.randomUUID(), state: 'queued', payload: clone(payload), attempts: 0, maxAttempts: 3, createdAt: now() });
    }
    state.state = 'running';
    event(state, 'started', { added: Array.isArray(payloads) ? payloads.length : 0 });
    save(owner, state);
    kick(owner);
    return status(owner);
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

  return { start, pause, resume, stop, status, waitForIdle };
}

module.exports = { BACKOFF_MS, createNovelFetchQueue };
