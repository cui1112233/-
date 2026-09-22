const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function safeUsername(username) {
  const value = String(username || '');
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(value)) throw new Error('Invalid username');
  return value;
}
function nowIso(clock) { return new Date(clock()).toISOString(); }

function createBatchFactoryV11Scheduler({ usersDir, submit, clock = Date.now, pollMs = 15000 } = {}) {
  if (!usersDir || typeof submit !== 'function') throw new Error('usersDir and submit are required');
  let timer = null;
  const running = new Set();

  function fileFor(username) {
    return path.join(usersDir, safeUsername(username), 'batch-factory-v11', 'schedules.json');
  }
  function read(username) {
    const file = fileFor(username);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  function write(username, schedules) {
    const file = fileFor(username);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.tmp-' + process.pid;
    fs.writeFileSync(temp, JSON.stringify(schedules, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, file);
  }
  function list(username) {
    return read(username).sort((a, b) => String(a.runAt).localeCompare(String(b.runAt)));
  }
  function create(username, input = {}) {
    safeUsername(username);
    const runAt = new Date(input.runAt || '').getTime();
    if (!Number.isFinite(runAt) || runAt <= clock()) throw Object.assign(new Error('runAt must be a future datetime'), { status: 400 });
    if (!input.batchId || !input.requestId) throw Object.assign(new Error('batchId and requestId are required'), { status: 400 });
    const item = {
      id: crypto.randomUUID(),
      username,
      batchId: String(input.batchId),
      bookId: input.bookId ? String(input.bookId) : '',
      requestId: String(input.requestId),
      provider: String(input.provider || 'personal_api'),
      runAt: new Date(runAt).toISOString(),
      inputSnapshot: input.inputSnapshot || {},
      status: 'scheduled',
      createdAt: nowIso(clock),
      updatedAt: nowIso(clock),
      errorMessage: ''
    };
    const schedules = read(username);
    schedules.push(item);
    write(username, schedules);
    return item;
  }
  function update(username, id, patch = {}) {
    const schedules = read(username);
    const index = schedules.findIndex(item => item.id === id);
    if (index < 0) throw Object.assign(new Error('schedule not found'), { status: 404 });
    const item = schedules[index];
    if (item.status !== 'scheduled') return item;
    if (patch.runAt !== undefined) {
      const runAt = new Date(patch.runAt).getTime();
      if (!Number.isFinite(runAt) || runAt <= clock()) throw Object.assign(new Error('runAt must be a future datetime'), { status: 400 });
      item.runAt = new Date(runAt).toISOString();
    }
    item.updatedAt = nowIso(clock);
    schedules[index] = item;
    write(username, schedules);
    return item;
  }
  function remove(username, id) {
    const schedules = read(username);
    const item = schedules.find(value => value.id === id);
    if (!item) throw Object.assign(new Error('schedule not found'), { status: 404 });
    if (item.status === 'running') throw Object.assign(new Error('running schedule cannot be deleted'), { status: 409 });
    write(username, schedules.filter(value => value.id !== id));
    return { deleted: true, id };
  }
  async function runDue(username) {
    const schedules = read(username);
    let changed = false;
    for (const item of schedules) {
      if (item.status !== 'scheduled' || Date.parse(item.runAt) > clock() || running.has(item.id)) continue;
      running.add(item.id);
      item.status = 'running';
      item.updatedAt = nowIso(clock);
      changed = true;
      write(username, schedules);
      try {
        await submit(item);
        item.status = 'done';
        item.errorMessage = '';
      } catch (error) {
        item.status = 'failed';
        item.errorMessage = error?.message || 'scheduled production failed';
      } finally {
        item.updatedAt = nowIso(clock);
        write(username, schedules);
        running.delete(item.id);
      }
    }
    return changed;
  }
  function start() {
    if (timer) return;
    timer = setInterval(() => {
      for (const username of fs.existsSync(usersDir) ? fs.readdirSync(usersDir) : []) {
        if (/^[a-zA-Z0-9_-]{3,32}$/.test(username)) runDue(username).catch(() => {});
      }
    }, pollMs);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { list, create, update, remove, runDue, start, stop };
}
module.exports = { createBatchFactoryV11Scheduler };
