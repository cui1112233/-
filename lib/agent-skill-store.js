const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { safeUserName } = require('./shared');

const MAX_BODY_LENGTH = 65536;
const MAX_SELECTED_SKILLS = 3;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const STATUS = new Set(['draft', 'published', 'archived']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function error(message, code = 'INVALID') {
  const instance = new Error(message);
  instance.code = code;
  return instance;
}

function text(value, maximum, { optional = false } = {}) {
  const result = String(value || '').trim();
  if ((!optional && !result) || result.length > maximum) throw error('技能内容不合法');
  return result;
}

function publicSkill(skill) {
  return {
    id: skill.id,
    source: skill.source,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    inputTemplate: skill.inputTemplate,
    version: skill.version,
    status: skill.status
  };
}

function createAgentSkillStore({ systemDir, usersDir, now = () => new Date().toISOString() } = {}) {
  if (!systemDir || !usersDir) throw new Error('systemDir and usersDir are required');
  const systemPath = path.join(systemDir, 'agent-skills.json');

  function privatePath(username) {
    return path.join(usersDir, safeUserName(username), 'agent-skills.json');
  }

  function read(filePath) {
    if (!fs.existsSync(filePath)) return [];
    try {
      const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function write(filePath, skills) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(skills, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  function normalize(input, { source, owner = null, id, version = 1, status = 'draft', createdAt = now(), createdBy }) {
    const name = text(input?.name, 120);
    const description = text(input?.description, 600, { optional: true });
    const category = text(input?.category, 80, { optional: true });
    const inputTemplate = text(input?.inputTemplate, 3000, { optional: true });
    const body = text(input?.body, MAX_BODY_LENGTH);
    const skillId = id || String(input?.id || '').trim() || crypto.randomUUID();
    if (!ID_PATTERN.test(skillId) || !['system', 'user'].includes(source) || !STATUS.has(status)) throw error('技能内容不合法');
    return { id: skillId, source, owner, name, description, category, inputTemplate, body, version, status, createdAt, createdBy };
  }

  function listVisible(username) {
    safeUserName(username);
    return [
      ...read(systemPath).filter(skill => skill.source === 'system' && skill.status === 'published'),
      ...read(privatePath(username)).filter(skill => skill.source === 'user' && skill.owner === username && skill.status !== 'archived')
    ].map(publicSkill);
  }

  function listPrivate(username) {
    return read(privatePath(username)).filter(skill => skill.owner === username).map(publicSkill);
  }

  function listSystem({ includeArchived = true } = {}) {
    return read(systemPath).filter(skill => includeArchived || skill.status === 'published').map(publicSkill);
  }

  function getPrivate(username, id) {
    const skill = read(privatePath(username)).find(item => item.owner === username && item.id === id);
    return skill ? clone(skill) : null;
  }

  function getSystem(id, version) {
    const skill = read(systemPath).find(item => item.id === id && (version === undefined || item.version === Number(version)));
    return skill ? clone(skill) : null;
  }

  function createPrivate(username, input) {
    const user = safeUserName(username);
    const filePath = privatePath(user);
    const skills = read(filePath);
    const skill = normalize(input, { source: 'user', owner: user, status: 'published', createdBy: user });
    skills.push(skill);
    write(filePath, skills);
    return publicSkill(skill);
  }

  function updatePrivate(username, id, input) {
    const user = safeUserName(username);
    const filePath = privatePath(user);
    const skills = read(filePath);
    const index = skills.findIndex(skill => skill.owner === user && skill.id === id);
    if (index < 0) throw error('技能不存在', 'NOT_FOUND');
    const current = skills[index];
    skills[index] = normalize({ ...current, ...input }, {
      source: 'user', owner: user, id: current.id, version: current.version + 1,
      status: 'published', createdAt: current.createdAt, createdBy: current.createdBy
    });
    write(filePath, skills);
    return publicSkill(skills[index]);
  }

  function deletePrivate(username, id) {
    const user = safeUserName(username);
    const filePath = privatePath(user);
    const skills = read(filePath);
    const next = skills.filter(skill => !(skill.owner === user && skill.id === id));
    if (next.length === skills.length) throw error('技能不存在', 'NOT_FOUND');
    write(filePath, next);
  }

  function createSystemDraft(actor, input) {
    const skills = read(systemPath);
    const id = String(input?.id || '').trim();
    if (!ID_PATTERN.test(id)) throw error('技能内容不合法');
    const version = skills.reduce((current, skill) => skill.id === id ? Math.max(current, skill.version) : current, 0) + 1;
    const skill = normalize(input, { source: 'system', id, version, status: 'draft', createdBy: safeUserName(actor) });
    skills.push(skill);
    write(systemPath, skills);
    return publicSkill(skill);
  }

  function setSystemStatus(actor, id, version, nextStatus) {
    safeUserName(actor);
    const skills = read(systemPath);
    const target = skills.find(skill => skill.id === id && skill.version === Number(version));
    if (!target) throw error('技能不存在', 'NOT_FOUND');
    if (nextStatus === 'published') {
      for (const skill of skills) if (skill.id === id && skill.status === 'published') skill.status = 'archived';
    }
    target.status = nextStatus;
    target.publishedAt = now();
    target.publishedBy = actor;
    write(systemPath, skills);
    return publicSkill(target);
  }

  function resolveForChat(username, ids) {
    const values = Array.isArray(ids) ? ids : [];
    if (values.length > MAX_SELECTED_SKILLS || new Set(values).size !== values.length || !values.every(id => typeof id === 'string' && ID_PATTERN.test(id))) {
      throw error('所选技能不合法');
    }
    const systemSkills = read(systemPath);
    const privateSkills = read(privatePath(username));
    return values.map(id => {
      const skill = systemSkills.find(item => item.id === id && item.source === 'system' && item.status === 'published')
        || privateSkills.find(item => item.id === id && item.source === 'user' && item.owner === username && item.status === 'published');
      if (!skill) throw error('所选技能不可用', 'FORBIDDEN');
      return clone(skill);
    });
  }

  return { listVisible, listPrivate, listSystem, getPrivate, getSystem, createPrivate, updatePrivate, deletePrivate, createSystemDraft, setSystemStatus, resolveForChat };
}

module.exports = { createAgentSkillStore, MAX_SELECTED_SKILLS };
