const test = require('node:test');
const assert = require('node:assert/strict');
const { registerNovelFetchV2Routes } = require('../lib/novel-fetch-workshop/v2-api-contract');

function registry() {
  const routes = new Map();
  const router = {};
  for (const method of ['get', 'post', 'patch', 'delete']) router[method] = (path, handler) => { routes.set(`${method.toUpperCase()} ${path}`, handler); return router; };
  return { router, routes };
}

async function call(handler, { username = 'alice', body = {}, params = {}, query = {} } = {}) {
  const response = { statusCode: 200, body: undefined, nextCount: 0, nextError: null };
  const res = { status(code) { response.statusCode = code; return this; }, json(value) { response.body = value; return value; } };
  const next = error => { response.nextCount += 1; response.nextError = error || null; };
  await handler({ username, body, params, query }, res, next);
  return response;
}

const queue = { status: () => ({ state: 'idle', items: [], events: [], updatedAt: '' }), start: () => ({}), pause: () => ({}), resume: () => ({}), stop: () => ({}) };
const scheduler = { list: () => [], create: () => ({}), update: () => ({}), remove: () => true };

test('legacy process start is blocked with 410 for permanent tombstones and otherwise falls through', async () => {
  const taskOps = { processConflicts(owner, payload) { return payload.input_text === 'blocked' ? ['book-a'] : []; }, list: async () => [], permanentDelete: async () => ({}), restoreTombstone: () => false, setAiCount: async () => ({ ok: true }) };
  const { router, routes } = registry();
  registerNovelFetchV2Routes(router, { queue, scheduler, taskOps });
  const handler = routes.get('POST /process/start');
  assert.ok(handler);
  const blocked = await call(handler, { body: { input_text: 'blocked' } });
  assert.equal(blocked.statusCode, 410);
  assert.deepEqual(blocked.body, { error: 'permanently_deleted', book_ids: ['book-a'] });
  assert.equal(blocked.nextCount, 0);
  const allowed = await call(handler, { body: { input_text: 'ok' } });
  assert.equal(allowed.nextCount, 1);
  assert.equal(allowed.body, undefined);
});

test('task list and permanent delete/restore use owner-scoped task ops', async () => {
  const calls = [];
  const taskOps = {
    processConflicts: () => [],
    async list(owner, query) { calls.push(['list', owner, query]); return [{ bookId: 'a' }]; },
    async permanentDelete(owner, ids) { calls.push(['delete', owner, ids]); return { deleted: ids.length, tombstoned: ids }; },
    restoreTombstone(owner, id) { calls.push(['restore', owner, id]); return id === 'a'; },
    async setAiCount() { return { ok: true }; }
  };
  const { router, routes } = registry();
  registerNovelFetchV2Routes(router, { queue, scheduler, taskOps });
  const listed = await call(routes.get('GET /tasks'), { username: 'bob', query: { date: '2026-08-30', bookId: '7' } });
  assert.deepEqual(listed.body, { tasks: [{ bookId: 'a' }] });
  const deleted = await call(routes.get('POST /tasks/batch-delete-permanent'), { username: 'bob', body: { ids: ['a', 'b'] } });
  assert.equal(deleted.body.deleted, 2);
  const restored = await call(routes.get('POST /tasks/:id/restore-tombstone'), { username: 'bob', params: { id: 'a' } });
  assert.deepEqual(restored.body, { restored: true, id: 'a' });
  assert.deepEqual(calls, [['list', 'bob', { date: '2026-08-30', bookId: '7' }], ['delete', 'bob', ['a', 'b']], ['restore', 'bob', 'a']]);
});

test('batch AI count returns 409 atomically on existing AI conflicts', async () => {
  const taskOps = { processConflicts: () => [], list: async () => [], permanentDelete: async () => ({}), restoreTombstone: () => false, async setAiCount() { return { ok: false, conflicts: ['b'], missing: [], updated: 0 }; } };
  const { router, routes } = registry();
  registerNovelFetchV2Routes(router, { queue, scheduler, taskOps });
  const result = await call(routes.get('POST /tasks/batch-ai-count'), { body: { ids: ['a', 'b'], ai_count: 3 } });
  assert.equal(result.statusCode, 409);
  assert.deepEqual(result.body.conflicts, ['b']);
});
