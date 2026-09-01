'use strict';

const { hasExplicitTargetVersions, effectiveTargetVersions } = require('./target-versions');

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function unique(values) { return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))]; }
function is121SessionError(error) {
  const message = String(error?.message || '');
  return error?.status === 401 || error?.code === 'BROWSER_SESSION_MISSING' || error?.code === 'BROWSER_CREDENTIALS_MISSING'
    || /121.*(?:登录|会话)|(?:登录|会话).*121|session.*(?:expired|missing)/i.test(message);
}

async function completedTargetVersions(store, owner, record) {
  const meta = object(record?.meta);
  if (!hasExplicitTargetVersions(meta)) return null;
  const target = effectiveTargetVersions(meta);
  const completed = [];
  for (const version of target) {
    const content = await store.readVersionText(owner, meta.bookId || record?.bookId || '', version);
    if (String(content || '').trim()) completed.push(version);
  }
  return completed;
}

function mergeSubmitResults(results = [], fallbackTasks = []) {
  return {
    material_limit: results.find(item => item?.material_limit !== undefined)?.material_limit,
    groups: results.flatMap(item => Array.isArray(item?.groups) ? item.groups : []),
    skipped: results.flatMap(item => Array.isArray(item?.skipped) ? item.skipped : []),
    success_groups: results.reduce((sum, item) => sum + (Number(item?.success_groups) || 0), 0),
    accepted_groups: results.reduce((sum, item) => sum + (Number(item?.accepted_groups) || 0), 0),
    failed_groups: results.reduce((sum, item) => sum + (Number(item?.failed_groups) || 0), 0),
    tasks: results.findLast?.(item => Array.isArray(item?.tasks))?.tasks || fallbackTasks
  };
}

function createTargetAwareWebSubmit({ service, accountResolver, createStore, onTaskUpdated } = {}) {
  if (!service || typeof service.submit !== 'function') throw new Error('web submit service is required');
  if (typeof accountResolver !== 'function') throw new Error('accountResolver is required');
  if (typeof createStore !== 'function') throw new Error('createStore is required');

  async function resources(owner) {
    const account = await Promise.resolve(accountResolver(owner));
    if (!account?.username || account.username !== owner) throw new Error(`账号 ${owner} 不存在或不可用`);
    return { account, store: createStore({ account }) };
  }

  async function notify(owner, store, id) {
    if (typeof onTaskUpdated !== 'function') return;
    try {
      const latest = await store.getTask(owner, id);
      if (latest?.meta) await Promise.resolve(onTaskUpdated(owner, latest.meta));
    } catch (_) {}
  }

  async function runSelected(method, owner, body = {}) {
    if (body?.mode !== 'selected' || !Array.isArray(body.ids)) return service[method](owner, body);
    const ids = unique(body.ids);
    const { store } = await resources(owner);
    const legacyIds = [];
    const results = [];
    const localSkipped = [];

    for (const id of ids) {
      const record = await store.getTask(owner, id);
      if (!record?.meta) {
        localSkipped.push({ id, status: 'failed', error: '任务不存在' });
        continue;
      }
      const versions = await completedTargetVersions(store, owner, record);
      if (versions === null) {
        legacyIds.push(id);
        continue;
      }
      if (!versions.length) {
        localSkipped.push({ id, status: 'skipped', error: '当前任务没有已完成的目标版本' });
        continue;
      }
      try {
        results.push(await service[method](owner, { ...body, mode: 'selected', ids: [id], versions }));
      } catch (error) {
        if (method === 'submit' && is121SessionError(error) && typeof store.updateTaskMeta === 'function') {
          await store.updateTaskMeta(owner, id, {
            siteSubmitStatus: '121异常',
            siteSubmitError: error?.message || '121 登录异常'
          });
        }
        throw error;
      } finally {
        if (method === 'submit') await notify(owner, store, id);
      }
    }

    if (legacyIds.length) {
      try {
        results.push(await service[method](owner, { ...body, mode: 'selected', ids: legacyIds }));
      } finally {
        if (method === 'submit') for (const id of legacyIds) await notify(owner, store, id);
      }
    }

    const tasks = typeof store.listTasks === 'function' ? await store.listTasks(owner) : [];
    const merged = mergeSubmitResults(results, tasks);
    merged.skipped = [...localSkipped, ...(merged.skipped || [])];
    return merged;
  }

  return {
    getConfig: (...args) => service.getConfig(...args),
    saveConfig: (...args) => service.saveConfig(...args),
    environment: (...args) => service.environment(...args),
    testVisible: (...args) => service.testVisible(...args),
    syncConfigs: (...args) => service.syncConfigs(...args),
    syncStyles: (...args) => service.syncStyles(...args),
    ensureSession: (...args) => service.ensureSession(...args),
    preview: (owner, body) => runSelected('preview', owner, body),
    submit: (owner, body) => runSelected('submit', owner, body)
  };
}

module.exports = { is121SessionError, completedTargetVersions, mergeSubmitResults, createTargetAwareWebSubmit };
