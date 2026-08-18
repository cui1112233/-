// tests/storage-novel-panel-export-contract.test.js
// 契约测试：工作台「导出结果」接线必须存在（POST /api/novel-panel/:id/export）。
// 防止 0eb30fc 重写工作台时删掉入口的回归再次发生（C1）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('novel workbench exposes the 导出结果 export wiring', () => {
  const html = read('public/novel-panel/workbench/index.html');
  assert.match(html, /<button id="exportResultBtn"[^>]*>导出结果<\/button>/);

  const app = read('public/novel-panel/workbench/app.js');
  assert.match(app, /function exportResult\(\)/);
  assert.match(app, /bindEvent\("#exportResultBtn", "click", exportResult\);/);
  assert.match(app, /\/api\/novel-panel\/\$\{encodeURIComponent\(state\.projectId\)\}\/export/);
});
