const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPagePath = path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'ScriptPage.jsx');

test('剧本视频模型下拉框读取统一视频模型目录', () => {
  const source = fs.readFileSync(scriptPagePath, 'utf8');
  const start = source.indexOf('setLoadingScriptVideoModels(true)');
  const end = source.indexOf("setLoadingScriptVideoModels(false)", start);
  assert.ok(start >= 0 && end > start, '未找到剧本视频模型加载逻辑');
  const loader = source.slice(start, end);

  assert.match(loader, /listAvailableModels\('video'\)/, '剧本页必须读取统一视频模型目录');
  assert.doesNotMatch(loader, /listModels\(\)/, '剧本页不能继续读取旧水货固定模型接口');
});
