const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Agent UI sends selected IDs and keeps platform skill bodies outside browser code', () => {
  const page = read('frontend/src/user/pages/AgentPage.jsx');
  const client = read('frontend/src/shared/api/agent.js');
  const pet = read('frontend/src/shared/pet/StackyPet.jsx');
  assert.match(page, /平台自带/);
  assert.match(page, /我的技能/);
  assert.match(page, /selectedSkillIds/);
  assert.match(page, /listAgentSkills/);
  assert.match(page, /新建我的技能/);
  assert.match(client, /skillIds/);
  assert.match(pet, /PET_SKILLS_EVENT/);
  assert.doesNotMatch(page, /PRE_ROLL_SKILL_BODY/);
});

test('Agent composer exposes the reference-style plus menu for contextual tools', () => {
  const page = read('frontend/src/user/pages/AgentPage.jsx');
  const css = read('frontend/src/shared/styles/global.css');
  assert.match(page, /添加文件/);
  assert.match(page, /模式/);
  assert.match(page, /专家/);
  assert.match(page, /技能/);
  assert.match(page, /连接器/);
  assert.match(page, /agent-composer-plus/);
  assert.match(page, /selectedMode/);
  assert.match(page, /selectedExpert/);
  assert.match(page, /attachedFile/);
  assert.match(css, /\.agent-composer-plus/);
  assert.match(css, /\.agent-composer-context/);
});

test('Agent keeps skills in the accessible composer panel without a legacy sidebar library', () => {
  const page = read('frontend/src/user/pages/AgentPage.jsx');
  const css = read('frontend/src/shared/styles/global.css');
  assert.match(page, /openComposerTool\('skill'\)/);
  assert.match(page, /composerPanel === 'skill'/);
  assert.match(page, /className="agent-skill-panel"/);
  assert.match(page, /className="agent-selected-skills"/);
  assert.match(page, /role="menuitem"[\s\S]*?技能/);
  assert.match(page, /toggleSkill\(skill\.id\)/);
  assert.match(page, /useTemplate\(skill\)/);
  assert.match(page, /openCreateSkill/);
  assert.match(page, /openEditSkill\(skill\.id\)/);
  assert.match(page, /removeSkill\(skill\.id\)/);
  assert.doesNotMatch(page, /skillLibraryCollapsed|agent-skill-library/);
  assert.match(css, /\.agent-skill-panel/);
  assert.match(css, /\.agent-selected-skills/);
});

test('Admin UI provides a separate platform skill library route', () => {
  assert.match(read('frontend/src/admin/App.jsx'), /pathname === '\/admin\/agent-skills'/);
  assert.match(read('frontend/src/shared/layouts/AdminLayout.jsx'), /href: '\/admin\/agent-skills'/);
  assert.match(read('frontend/src/admin/pages/DashboardPage.jsx'), /\/admin\/agent-skills/);
  const api = read('frontend/src/shared/api/admin.js');
  assert.match(api, /agent-skills/);
});
