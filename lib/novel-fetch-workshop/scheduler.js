const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function safeUsername(username) {
  const value = String(username || '').trim();
  if (!USERNAME_PATTERN.test(value)) throw new Error('Invalid username');
  return value;
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return { schedules: [] };
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { schedules: Array.isArray(parsed?.schedules) ? parsed.schedules : [] };
}

function createNovelFetchScheduler({ usersDir, clock = () => new Date(), execute = async () => ({ ok: true }) } = {}) {
  if (!usersDir) throw new Error('usersDir is required');
  const active = new Set();

  function fileFor(username) {
    return path.join(usersDir, safeUsername(username), 'novel-fetch-v2', 'schedules.json');
  }

  function read(username) {
    const filePath = fileFor(username);
    const data = readJson(filePath);
    let changed = false;
    for (const item of data.schedules) {
      if (item.status === 'running' && item.enabled !== false) {
        item.status = 'scheduled';
        item.recoveredAt = clock().toISOString();
        changed = true;
      }
    }
    if (changed) atomicWriteJson(filePath, data);
    return data;
  }

  function write(username, data) {
    atomicWriteJson(fileFor(username), data);
  }

  function list(username) {
    return read(username).schedules.slice().sort((a, b) => String(a.runAt).localeCompare(String(b.runAt)));
  }

  function create(username, input = {}) {
    const runAt = new Date(input.runAt);
    if (!Number.isFinite(runAt.getTime())) throw new Error('runAt is required');
    const data = read(username);
    const now = clock().toISOString();
    const item = {
      id: String(input.id || crypto.randomUUID()),
      runAt: runAt.toISOString(),
      enabled: input.enabled !== false,
      status: input.status || 'scheduled',
      inputSnapshot: input.inputSnapshot && typeof input.inputSnapshot === 'object' ? input.inputSnapshot : {},
      createdAt: now,
      updatedAt: now
    };
    data.schedules.push(item);
    write(username, data);
    return { ...item };
  }

  function update(username, id, patch = {}) {
    const data = read(username);
    const index = data.schedules.findIndex(item => item.id === id);
    if (index < 0) return null;
    const next = { ...data.schedules[index], ...patch, id: data.schedules[index].id, updatedAt: clock().toISOString() };
    if (patch.runAt !== undefined) {
      const runAt = new Date(patch.runAt);
      if (!Number.isFinite(runAt.getTime())) throw new Error('invalid runAt');
      next.runAt = runAt.toISOString();
    }
    data.schedules[index] = next;
    write(username, data);
    return { ...next };
  }

  function remove(username, id) {
    const data = read(username);
    const before = data.schedules.length;
    data.schedules = data.schedules.filter(item => item.id !== id);
    if (data.schedules.length !== before) write(username, data);
    return data.schedules.length !== before;
  }

  async function runDue(username) {
    const user = safeUsername(username);
    const nowMs = clock().getTime();
    const snapshot = list(user).filter(item => item.enabled !== false && item.status === 'scheduled' && new Date(item.runAt).getTime() <= nowMs);
    const results = [];
    for (const item of snapshot) {
      const key = `${user}:${item.id}`;
      if (active.has(key)) continue;
      active.add(key);
      try {
        const current = list(user).find(entry => entry.id === item.id);
        if (!current || current.enabled === false || current.status !== 'scheduled') continue;
        update(user, item.id, { status: 'running', startedAt: clock().toISOString(), error: '' });
        try {
          const result = await execute({ ...current, owner: user });
          update(user, item.id, { status: 'done', completedAt: clock().toISOString(), result: result ?? null });
          results.push({ id: item.id, status: 'done', result: result ?? null });
        } catch (error) {
          update(user, item.id, { status: 'failed', completedAt: clock().toISOString(), error: error?.message || String(error) });
          results.push({ id: item.id, status: 'failed', error: error?.message || String(error) });
        }
      } finally {
        active.delete(key);
      }
    }
    return results;
  }

  async function runAllDue() {
    if (!fs.existsSync(usersDir)) return [];
    const results = [];
    for (const entry of fs.readdirSync(usersDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !USERNAME_PATTERN.test(entry.name)) continue;
      results.push(...await runDue(entry.name));
    }
    return results;
  }

  return { create, list, update, remove, runDue, runAllDue };
}

module.exports = { createNovelFetchScheduler };
