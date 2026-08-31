const fs = require('node:fs');
const path = require('node:path');

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function safeUsername(username) {
  const value = String(username || '').trim();
  if (!USERNAME_PATTERN.test(value)) throw new Error('invalid queue owner');
  return value;
}
function emptyQueue() { return { state: 'idle', items: [], events: [], updatedAt: '' }; }
function normalizeQueue(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    state: ['idle', 'running', 'paused', 'stopping'].includes(source.state) ? source.state : 'idle',
    items: Array.isArray(source.items) ? source.items.filter(item => item && typeof item === 'object' && item.id) : [],
    events: Array.isArray(source.events) ? source.events.slice(-200) : [],
    updatedAt: String(source.updatedAt || '')
  };
}
function createQueueStore({ usersDir, clock = () => new Date() } = {}) {
  if (!usersDir) throw new Error('usersDir is required');
  function fileFor(username) { return path.join(path.resolve(usersDir), safeUsername(username), 'novel-fetch-workshop', 'queue.json'); }
  function read(username) {
    try { return normalizeQueue(JSON.parse(fs.readFileSync(fileFor(username), 'utf8'))); }
    catch (error) { if (error?.code === 'ENOENT') return emptyQueue(); throw error; }
  }
  function replace(username, value) {
    const file = fileFor(username);
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const next = normalizeQueue({ ...value, updatedAt: clock().toISOString() });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(temp, file);
    return next;
  }
  function load(username) {
    const current = read(username);
    let changed = false;
    const items = current.items.map(item => {
      if (item.state !== 'running') return item;
      changed = true;
      return { ...item, state: 'queued', recoveredAt: clock().toISOString() };
    });
    if (!changed && current.state !== 'running' && current.state !== 'stopping') return current;
    return replace(username, {
      ...current,
      state: 'idle',
      items,
      events: [...current.events, { type: 'recovered_after_restart', at: clock().toISOString() }].slice(-200)
    });
  }
  return { read, load, replace, fileFor };
}

module.exports = { createQueueStore };
