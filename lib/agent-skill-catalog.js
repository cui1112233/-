const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_LOCAL_SKILLS_DIR = '/Users/ming/Downloads/skills';
const PRE_ROLL_SKILL_BODY = [
  'PRE_ROLL_SKILL_BODY',
  '为前贴片广告脚本输出且只能输出 Markdown 表格，表头固定为：镜号｜画面内容（视觉/动作/文字包装）｜旁白/台词（听觉）｜音效/BGM｜预估时长。',
  '第 1 镜的前三秒必须采用视觉冲击、痛点或反直觉 Hook。结尾必须给出明确 CTA。总时长必须与用户指定时长一致。',
  '不能声称已发布、拍摄、上传或执行任何外部操作。'
].join('\n');

const DEFAULT_AGENT_SKILLS = Object.freeze([{
  id: 'pre-roll-ad-script',
  name: '前贴片广告脚本',
  description: '生成可拍摄的前贴片广告分镜脚本。',
  category: '广告创作',
  inputTemplate: '请为我生成一个前贴片视频脚本：\n1. 产品/品牌名称：\n2. 核心卖点（USP）：\n3. 目标受众：\n4. 投放渠道与时长：\n5. 视频风格：',
  body: PRE_ROLL_SKILL_BODY
}]);

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return {}; }
}

function frontMatterValue(body, key) {
  const match = String(body || '').match(new RegExp(`^---\\s*\\n[\\s\\S]*?^${key}:\\s*["']?([^\\n"']+)["']?\\s*$[\\s\\S]*?^---`, 'm'));
  return match ? match[1].trim() : '';
}

function firstHeading(body) {
  const match = String(body || '').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function safeIdPart(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'skill';
}

function loadLocalSkillCatalog({ skillsRoot = DEFAULT_LOCAL_SKILLS_DIR } = {}) {
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) return null;
      const body = fs.readFileSync(skillPath, 'utf8').trim();
      if (!body) return null;
      const meta = readJson(path.join(skillsRoot, entry.name, '_skillhub_meta.json'));
      const name = String(meta.name || frontMatterValue(body, 'display_name') || frontMatterValue(body, 'name') || firstHeading(body) || entry.name).trim().slice(0, 120);
      const description = String(meta.description_zh || frontMatterValue(body, 'description_zh') || frontMatterValue(body, 'description') || '导入的本地技能。').trim().slice(0, 600);
      return {
        id: `local-skill-${safeIdPart(entry.name)}`,
        name,
        description,
        category: '本地导入',
        inputTemplate: '',
        body
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function seedAgentSkills(store, actor, { skillsRoot = DEFAULT_LOCAL_SKILLS_DIR } = {}) {
  for (const skill of [...DEFAULT_AGENT_SKILLS, ...loadLocalSkillCatalog({ skillsRoot })]) {
    if (store.getSystem(skill.id)) continue;
    const draft = store.createSystemDraft(actor, skill);
    store.setSystemStatus(actor, draft.id, draft.version, 'published');
  }
}

module.exports = { DEFAULT_AGENT_SKILLS, DEFAULT_LOCAL_SKILLS_DIR, PRE_ROLL_SKILL_BODY, loadLocalSkillCatalog, seedAgentSkills };
