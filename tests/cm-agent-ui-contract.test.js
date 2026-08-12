const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('CM supports drag, double-click analysis, questions, and explicit script application', () => {
  const pet = read('frontend/src/shared/pet/StackyPet.jsx');
  const scriptPage = read('frontend/src/user/pages/ScriptPage.jsx');
  const css = read('frontend/src/shared/styles/global.css');

  assert.match(pet, /onPointerDown=\{handlePointerDown\}/);
  assert.match(pet, /dispatchPetState/);
  assert.match(pet, /import \{[\s\S]*?dispatchPetState[\s\S]*?\} from '\.\/stacky';/);
  assert.match(pet, /function handlePointerUp\(event\) \{\s*if \(!dragRef\.current\) return;\s*event\.currentTarget\.releasePointerCapture\(event\.pointerId\);\s*dragRef\.current = null;/);
  assert.match(pet, /onDoubleClick=\{handlePetDoubleClick\}/);
  assert.match(pet, /clampOverlayToViewport/);
  assert.match(pet, /window\.addEventListener\('resize', keepOverlayVisible\)/);
  assert.match(pet, /请分析我当前页面的内容/);
  assert.match(pet, /问问 CM/);
  assert.match(pet, /关闭 CM 对话/);
  assert.match(pet, /setChatOpen\(false\)/);
  assert.match(pet, /event\.key === 'Escape'/);
  assert.match(pet, /应用到剧本/);
  assert.match(scriptPage, /dispatchPetContext/);
  assert.match(scriptPage, /PET_APPLY_EVENT/);
  assert.match(css, /\.stacky-agent-panel/);
  assert.match(css, /\.stacky-agent-input/);
  assert.match(css, /\.stacky-agent-close/);
  assert.match(css, /\.cm-conversation-frame/);
  assert.match(css, /\.cm-conversation-frame::before/);
  assert.match(css, /linear-gradient\(to right, rgba\(160, 153, 216/);
});

test('Agent frontend API exposes task conversation endpoints', () => {
  const agentApi = read('frontend/src/shared/api/agent.js');

  assert.match(agentApi, /export function listAgentTasks\(\)\s*\{\s*return apiRequest\('\/api\/agent\/tasks'\);/);
  assert.match(agentApi, /export function createAgentTask\(\)\s*\{\s*return apiRequest\('\/api\/agent\/tasks', \{ method: 'POST' \}\);/);
  assert.match(agentApi, /export function getAgentTask\(id\)\s*\{\s*return apiRequest\(`\/api\/agent\/tasks\/\$\{encodeURIComponent\(id\)\}`\);/);
  assert.match(agentApi, /export function renameAgentTask\(id, title\)\s*\{\s*return apiRequest\(`\/api\/agent\/tasks\/\$\{encodeURIComponent\(id\)\}`, \{ method: 'PATCH', body: JSON\.stringify\(\{ title \}\) \}\);/);
  assert.match(agentApi, /export function clearAgentTask\(id\)\s*\{\s*return apiRequest\(`\/api\/agent\/tasks\/\$\{encodeURIComponent\(id\)\}\/messages`, \{ method: 'DELETE' \}\);/);
  assert.match(agentApi, /export function deleteAgentTask\(id\)\s*\{\s*return apiRequest\(`\/api\/agent\/tasks\/\$\{encodeURIComponent\(id\)\}`, \{ method: 'DELETE' \}\);/);
  assert.match(agentApi, /export function askAgent\(\{ taskId, prompt, context, skillIds = \[\] \}\)/);
  assert.match(agentApi, /JSON\.stringify\(\{ taskId, prompt, context, skillIds \}\)/);
  assert.doesNotMatch(agentApi, /getAgentHistory|clearAgentHistory/);
});
