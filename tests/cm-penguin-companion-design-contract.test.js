const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('02 CM Penguin Companion is mounted without deleting legacy pet implementation', () => {
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');
  const legacyPet = read('frontend/src/shared/pet/StackyPet.jsx');
  const companion = read('frontend/src/shared/pet/CmPenguinCompanion.jsx');

  assert.match(layout, /import \{ CmPenguinCompanion \} from '\.\.\/pet\/CmPenguinCompanion';/);
  assert.match(layout, /<CmPenguinCompanion username=\{username\} accountSessionKey=\{accountSessionKey\} \/>/);
  assert.ok(legacyPet.includes('export function StackyPet'), 'legacy pet should remain available for rollback');
  assert.match(companion, /cm-penguin-context-chip/);
  assert.match(companion, /我知道你正在看/);
  assert.match(companion, /在 Agent 工作区继续/);
});

test('CM bridge only dispatches allow-listed structured actions', () => {
  const bridge = read('frontend/src/shared/pet/cmBridge.js');
  const parser = read('frontend/src/shared/pet/cmActionProposal.js');
  const companion = read('frontend/src/shared/pet/CmPenguinCompanion.jsx');

  assert.match(bridge, /CM_ACTION_TYPES/);
  assert.match(bridge, /character\.update/);
  assert.match(bridge, /constraint\.bind/);
  assert.match(bridge, /segment\.update/);
  assert.match(bridge, /tts\.update/);
  assert.match(bridge, /normalizeCmAction/);
  assert.match(parser, /```cm-actions/);
  assert.match(parser, /JSON\.parse/);
  assert.match(companion, /dispatchCmAction/);
  assert.match(companion, /等待功能区接入/);
});

test('CM metadata is folded into the server-approved agent context fields', () => {
  const api = read('frontend/src/shared/api/agent.js');

  assert.match(api, /function prepareAgentContext/);
  assert.match(api, /cmSelection/);
  assert.match(api, /cmCapabilities/);
  assert.match(api, /CM 当前选中对象/);
  assert.match(api, /CM 当前页面允许申请的动作/);
  assert.match(api, /summary:/);
  assert.match(api, /entities:/);
  assert.match(api, /actions:/);
  assert.match(api, /context: prepareAgentContext\(context\)/);
});
