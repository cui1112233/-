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

test('CM Agent renders account-scoped task conversations and keeps skills in the composer', () => {
  const page = read('frontend/src/user/pages/AgentPage.jsx');
  const pet = read('frontend/src/shared/pet/StackyPet.jsx');
  const css = read('frontend/src/shared/styles/global.css');

  assert.match(page, /listAgentTasks/);
  assert.match(page, /createAgentTask/);
  assert.match(page, /getAgentTask/);
  assert.match(page, /renameAgentTask/);
  assert.match(page, /clearAgentTask/);
  assert.match(page, /deleteAgentTask/);
  assert.match(page, /const \[tasks, setTasks\] = useState\(\[\]\)/);
  assert.match(page, /const \[activeTaskId, setActiveTaskId\] = useState\(null\)/);
  assert.match(page, /const \[activeTask, setActiveTask\] = useState\(null\)/);
  assert.match(page, /新建聊天/);
  assert.match(page, /agent-task-sidebar/);
  assert.match(page, /agent-task-row/);
  assert.match(page, /重命名任务/);
  assert.match(page, /clearAgentTask\(taskId\)/);
  assert.match(page, /deleteAgentTask\(taskId\)/);
  assert.match(page, /composerPanel === 'skill'/);
  assert.match(page, /新建我的技能/);
  assert.doesNotMatch(page, /<aside className="agent-skill-library/);
  assert.match(css, /\.agent-task-sidebar/);
  assert.match(css, /\.agent-task-row/);
  assert.doesNotMatch(pet, /getAgentHistory|clearAgentHistory/);
  assert.match(pet, /createAgentTask/);
  assert.match(pet, /getAgentTask/);
  assert.match(pet, /askAgent\(\{[\s\S]*?taskId/);
});

test('CM task workspace preserves active conversations and remains usable on narrow screens', () => {
  const page = read('frontend/src/user/pages/AgentPage.jsx');
  const pet = read('frontend/src/shared/pet/StackyPet.jsx');
  const css = read('frontend/src/shared/styles/global.css');

  assert.match(page, /const activeTaskIdRef = useRef\(null\)/);
  assert.match(page, /activeTaskIdRef\.current = taskId/);
  assert.match(page, /if \(activeTaskIdRef\.current === taskId\) setActiveTask\(nextTask\)/);
  assert.match(page, /if \(event\.nativeEvent\.isComposing\) return;/);
  assert.match(pet, /const petTaskIdRef = useRef\(null\)/);
  assert.match(pet, /async function loadPetTask\(taskId\)/);
  assert.match(pet, /loadPetTask\(taskId\)\.catch\(\(\) => undefined\)/);
  assert.doesNotMatch(pet, /listAgentTasks/);
  assert.match(pet, /getAgentTask/);
  assert.match(css, /\.agent-page \{[^}]*min-height: 0;[^}]*overflow: auto;[^}]*overflow-x: hidden;[^}]*\}/);
  assert.match(css, /@media \(max-width: 860px\) \{[\s\S]*?\.agent-page \{[^}]*min-height: 0;[^}]*overflow: auto;[^}]*overflow-x: hidden;[^}]*\}/);
  assert.match(css, /\[data-theme='light'\] \.stacky-agent-close[^}]*background: #ffffff;[^}]*color: var\(--legacy-text\);/);
});

test('CM task UI resets across accounts and protects the composer while task details load', () => {
  const page = read('frontend/src/user/pages/AgentPage.jsx');
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');
  const css = read('frontend/src/shared/styles/global.css');

  assert.match(layout, /const accountSessionKey = username \|\| 'anonymous';/);
  assert.match(layout, /<Fragment key=\{accountSessionKey\}>[\s\S]*?<section className="legacy-content">\{content\}<\/section>[\s\S]*?<StackyPet \/>[\s\S]*?<\/Fragment>/);
  assert.match(page, /const \[taskDetailLoading, setTaskDetailLoading\] = useState\(false\)/);
  assert.match(page, /const taskDetailLoadingRef = useRef\(false\)/);
  assert.match(page, /taskDetailLoadingRef\.current = true;/);
  assert.match(page, /if \(!prompt \|\| asking \|\| taskDetailLoadingRef\.current\) return;/);
  assert.match(page, /role="status">正在读取任务列表\.\.\.<\/div>/);
  assert.match(page, /role="status">正在读取任务详情\.\.\.<\/div>/);
  assert.match(page, /disabled=\{taskDetailLoading\}/);
  assert.match(page, /aria-expanded=\{composerMenuOpen\}/);
  assert.match(page, /aria-controls=\{composerMenuId\}/);
  assert.match(page, /id=\{composerMenuId\} role="menu"/);
  assert.match(page, /role="menuitem"/);
  assert.match(page, /event\.key === 'Escape'/);
  assert.match(page, /composerTriggerRef\.current\?\.focus\(\)/);
  assert.match(css, /@media \(max-width: 360px\) \{[\s\S]*?\.stacky-agent-panel \{[^}]*right: 8px;[^}]*left: 8px;[^}]*width: auto;/);
});
