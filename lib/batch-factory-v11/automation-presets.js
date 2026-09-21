const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function text(value) { return String(value || '').trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function defaultStatePath() {
  const base = text(process.env.QIANTIE_BATCH_FACTORY_AUTOMATION_DIR)
    || text(process.env.QIANTIE_DATA_DIR)
    || path.join(process.cwd(), 'data');
  return path.join(base, 'batch-factory-v11-automation-presets.json');
}

function createAutomationPresetStore({ statePath = defaultStatePath(), now = Date.now } = {}) {
  let state = { version: 1, presets: {} };
  let writeChain = Promise.resolve();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state = { version: 1, presets: object(parsed?.presets) };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const persist = () => {
    const snapshot = JSON.stringify(state, null, 2);
    writeChain = writeChain.then(async () => {
      await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
      const temporary = `${statePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(temporary, snapshot, { mode: 0o600 });
      await fs.promises.rename(temporary, statePath);
    });
    return writeChain;
  };
  const values = owner => Array.isArray(state.presets[text(owner)]) ? state.presets[text(owner)] : [];
  const publicValue = value => clone(value);

  async function list(owner) {
    return values(owner).map(publicValue).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }
  async function get(owner, id) {
    const value = values(owner).find(item => item.id === text(id));
    if (!value) return null;
    return publicValue(value);
  }
  async function create(owner, input = {}) {
    const name = text(input.name);
    const config = object(input.config);
    if (!text(owner) || !name || !Object.keys(config).length) throw new Error('自动化预设需要名称和完整配置');
    const timestamp = new Date(now()).toISOString();
    const value = { id: `auto-preset-${crypto.randomUUID()}`, name, version: 1, config: clone(config), createdAt: timestamp, updatedAt: timestamp };
    const ownerKey = text(owner);
    state.presets[ownerKey] = [...values(ownerKey), value];
    await persist();
    return publicValue(value);
  }
  async function update(owner, id, input = {}) {
    const ownerKey = text(owner);
    const index = values(ownerKey).findIndex(item => item.id === text(id));
    if (index < 0) throw new Error('自动化预设不存在');
    const current = values(ownerKey)[index];
    if (Number(input.expectedVersion) !== Number(current.version)) throw new Error('自动化预设版本已变化，请刷新后重试');
    const name = text(input.name) || current.name;
    const config = Object.keys(object(input.config)).length ? clone(input.config) : current.config;
    const next = { ...current, name, config, version: Number(current.version) + 1, updatedAt: new Date(now()).toISOString() };
    state.presets[ownerKey] = values(ownerKey).map((item, valueIndex) => valueIndex === index ? next : item);
    await persist();
    return publicValue(next);
  }
  async function remove(owner, id) {
    const ownerKey = text(owner);
    const before = values(ownerKey);
    const after = before.filter(item => item.id !== text(id));
    if (after.length === before.length) throw new Error('自动化预设不存在');
    state.presets[ownerKey] = after;
    await persist();
  }
  return { list, get, create, update, remove, statePath };
}

module.exports = { createAutomationPresetStore };
