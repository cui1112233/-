const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAgentSkillStore } = require('../lib/agent-skill-store');
const { loadLocalSkillCatalog, seedAgentSkills } = require('../lib/agent-skill-catalog');

function createStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-agent-skills-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return createAgentSkillStore({ systemDir: path.join(root, 'system'), usersDir: path.join(root, 'users') });
}

test('skill lists expose metadata only and private skills remain account-local', t => {
  const store = createStore(t);
  seedAgentSkills(store, 'choushiyiguai');
  const privateSkill = store.createPrivate('writer_a', {
    name: '我的节奏检查',
    description: '检查剧情转折和节奏。',
    category: '剧本',
    inputTemplate: '请检查这段剧本的节奏：',
    body: 'PRIVATE_SKILL_BODY'
  });

  const writerA = store.listVisible('writer_a');
  const writerB = store.listVisible('writer_b');
  assert.equal(writerA.some(skill => skill.id === privateSkill.id), true);
  assert.equal(writerB.some(skill => skill.id === privateSkill.id), false);
  assert.equal(JSON.stringify(writerA).includes('PRIVATE_SKILL_BODY'), false);
  assert.equal(JSON.stringify(writerA).includes('PRE_ROLL_SKILL_BODY'), false);
  assert.throws(() => store.resolveForChat('writer_b', [privateSkill.id]), /不可用/);
});

test('published pre-roll skill resolves only on the server for an active account request', t => {
  const store = createStore(t);
  seedAgentSkills(store, 'choushiyiguai');
  const listed = store.listVisible('writer_a');
  const preRoll = listed.find(skill => skill.id === 'pre-roll-ad-script');
  assert.deepEqual(Object.keys(preRoll).sort(), ['category', 'description', 'id', 'inputTemplate', 'name', 'source', 'status', 'version']);
  const [resolved] = store.resolveForChat('writer_a', ['pre-roll-ad-script']);
  assert.match(resolved.body, /PRE_ROLL_SKILL_BODY/);
  assert.match(resolved.body, /镜号/);
});

test('local Skill folders import each SKILL.md as a separate platform skill without scripts or duplicate versions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-local-skills-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const skillsRoot = path.join(root, 'skills');
  fs.mkdirSync(path.join(skillsRoot, 'visual-helper', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(skillsRoot, 'visual-helper', '_skillhub_meta.json'), JSON.stringify({ name: '视觉助手' }));
  fs.writeFileSync(path.join(skillsRoot, 'visual-helper', 'SKILL.md'), '---\ndescription: 生成视觉方案\n---\n# 视觉助手\n\n完整指令');
  fs.writeFileSync(path.join(skillsRoot, 'visual-helper', 'scripts', 'run.js'), 'SECRET_SCRIPT_CODE');
  fs.mkdirSync(path.join(skillsRoot, 'story-helper'), { recursive: true });
  fs.writeFileSync(path.join(skillsRoot, 'story-helper', 'SKILL.md'), '# 故事助手\n\n完整故事规则');

  const catalog = loadLocalSkillCatalog({ skillsRoot });
  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog.map(skill => skill.id), ['local-skill-story-helper', 'local-skill-visual-helper']);
  assert.equal(catalog[1].name, '视觉助手');
  assert.match(catalog[1].body, /完整指令/);
  assert.doesNotMatch(catalog[1].body, /SECRET_SCRIPT_CODE/);

  const store = createStore(t);
  seedAgentSkills(store, 'choushiyiguai', { skillsRoot });
  seedAgentSkills(store, 'choushiyiguai', { skillsRoot });
  assert.equal(store.listSystem().filter(skill => skill.id.startsWith('local-skill-')).length, 2);
});

test('platform skill store accepts a full local Skill instruction up to 64 KB', t => {
  const store = createStore(t);
  const fullInstruction = '规则'.repeat(28000);
  const draft = store.createSystemDraft('choushiyiguai', {
    id: 'large-local-skill', name: '完整本地技能', description: '保留完整正文。', category: '本地导入', inputTemplate: '', body: fullInstruction
  });
  store.setSystemStatus('choushiyiguai', draft.id, draft.version, 'published');
  assert.equal(store.resolveForChat('writer_a', ['large-local-skill'])[0].body.length, fullInstruction.length);
});

test('the supplied Downloads skills folder exposes every top-level SKILL.md for platform import', () => {
  const skillsRoot = '/Users/ming/Downloads/skills';
  const expected = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md')))
    .map(entry => `local-skill-${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)}`)
    .sort();
  assert.deepEqual(loadLocalSkillCatalog({ skillsRoot }).map(skill => skill.id), expected);
  assert.equal(expected.length, 36);
});
