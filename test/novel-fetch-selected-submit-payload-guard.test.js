const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const scriptPath = path.join(__dirname, '..', 'public', 'batch-rewrite', 'v78-selected-submit-payload-guard.js');
const source = fs.readFileSync(scriptPath, 'utf8');

const sent = [];
const listeners = {};
const checkbox = { checked: true, dataset: { id: '2070666105350264547' }, matches: selector => selector === '.task-check' };
const context = {
  console,
  document: {
    querySelectorAll(selector) {
      if (selector === '.task-check:checked') return checkbox.checked ? [checkbox] : [];
      return [];
    },
    addEventListener(name, handler) { listeners[name] = handler; },
  },
  window: {
    fetch: async (input, init) => { sent.push({ input, init }); return { ok: true }; },
  },
};
context.window.window = context.window;
context.window.document = context.document;
vm.createContext(context);
vm.runInContext(source, context);

listeners.change?.({ target: checkbox });
checkbox.checked = false;

(async () => {
  await context.window.fetch('/api/batch-rewrite/web-submit/submit', {
    method: 'POST',
    body: JSON.stringify({ mode: 'selected', ids: [], force: false, grouped: true }),
  });
  assert.equal(sent.length, 1);
  const payload = JSON.parse(sent[0].init.body);
  assert.deepEqual(Array.from(payload.ids), ['2070666105350264547']);
  console.log('SELECTED_SUBMIT_PAYLOAD_GUARD_OK');
})().catch(error => { console.error(error); process.exit(1); });
