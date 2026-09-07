const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const mainPath = path.join(repoRoot, 'frontend/src/user/main.jsx');
const scriptPagePath = path.join(repoRoot, 'frontend/src/user/pages/ScriptPage.jsx');
const adapterPath = path.join(repoRoot, 'frontend/src/user/scriptConstraintInline.js');
const stylePath = path.join(repoRoot, 'frontend/src/user/script-constraint-inline.css');

test('剧本约束设置恢复为独立弹跳卡片，不再内嵌到分镜区域', () => {
  const main = fs.readFileSync(mainPath, 'utf8');
  const scriptPage = fs.readFileSync(scriptPagePath, 'utf8');

  assert.doesNotMatch(main, /scriptConstraintInline/,
    '用户端入口不得再安装剧本约束设置卡片内展开适配器');
  assert.doesNotMatch(main, /script-constraint-inline\.css/,
    '用户端入口不得再加载卡片内展开样式');

  assert.equal(fs.existsSync(adapterPath), false,
    '卡片内展开适配器应删除，避免两套展示逻辑互相干扰');
  assert.equal(fs.existsSync(stylePath), false,
    '卡片内展开样式应删除，恢复 Ant Modal 默认遮罩与定位');

  assert.match(scriptPage, /<Modal\s+[\s\S]*?title="约束设置"[\s\S]*?open=\{constraintModalOpen\}[\s\S]*?onCancel=\{\(\) => setConstraintModalOpen\(false\)\}[\s\S]*?onOk=\{saveConstraints\}[\s\S]*?width=\{720\}/,
    '约束设置必须继续使用现有 Ant Modal 弹跳卡片与保存逻辑');
});
