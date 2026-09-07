const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const mainPath = path.join(repoRoot, 'frontend/src/user/main.jsx');
const adapterPath = path.join(repoRoot, 'frontend/src/user/scriptConstraintInline.js');
const stylePath = path.join(repoRoot, 'frontend/src/user/script-constraint-inline.css');

test('剧本约束设置在当前剧本卡片内展开，而不是独立遮罩弹窗', () => {
  const main = fs.readFileSync(mainPath, 'utf8');

  assert.match(main, /scriptConstraintInline/,
    '用户端入口必须安装剧本约束设置卡片内展开适配器');
  assert.match(main, /script-constraint-inline\.css/,
    '用户端入口必须加载卡片内展开样式');

  assert.equal(fs.existsSync(adapterPath), true,
    '必须存在剧本约束卡片内展开适配器');
  assert.equal(fs.existsSync(stylePath), true,
    '必须存在剧本约束卡片内展开样式');

  const adapter = fs.readFileSync(adapterPath, 'utf8');
  const styles = fs.readFileSync(stylePath, 'utf8');

  assert.match(adapter, /约束设置/);
  assert.match(adapter, /\.script-right/);
  assert.match(adapter, /\.script-toolbar/);
  assert.match(adapter, /script-constraint-inline-slot/);
  assert.match(adapter, /aria-expanded/,
    '约束按钮必须暴露展开/收起状态');
  assert.match(adapter, /ant-modal-close/,
    '再次点击约束按钮时必须能收起当前卡片');

  assert.match(styles, /\.script-constraint-inline-wrap\s+\.ant-modal-mask|\.script-constraint-inline-root\s+\.ant-modal-mask/,
    '约束设置展开时必须去掉独立弹窗遮罩');
  assert.match(styles, /\.script-constraint-inline-slot/,
    '必须为右侧剧本卡片预留约束设置的原位空间');
});
