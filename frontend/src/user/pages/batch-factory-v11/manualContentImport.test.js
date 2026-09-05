import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePastedContent,
  normalizeImportedFile,
  canImportFile
} from './manualContentImport.js';

test('parsePastedContent splits multiple entries only on a delimiter line and derives titles', () => {
  const items = parsePastedContent('第一篇正文\n---\n第二篇正文');
  assert.deepEqual(items, [
    { title: '手动导入 01', sourceText: '第一篇正文', txtText: '第一篇正文', txtFileName: 'manual-01.txt' },
    { title: '手动导入 02', sourceText: '第二篇正文', txtText: '第二篇正文', txtFileName: 'manual-02.txt' }
  ]);
});

test('parsePastedContent keeps delimiter-like text inside a line', () => {
  const items = parsePastedContent('人物说 --- 继续\n第二行');
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceText, '人物说 --- 继续\n第二行');
});

test('parsePastedContent rejects empty content', () => {
  assert.throws(() => parsePastedContent(' \n---\n\n'), /请输入至少一篇有效内容/);
});

test('canImportFile accepts only TXT and MD files', () => {
  assert.equal(canImportFile({ name: '故事.TXT', type: 'text/plain' }), true);
  assert.equal(canImportFile({ name: '故事.md', type: 'text/markdown' }), true);
  assert.equal(canImportFile({ name: '故事.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), false);
});

test('normalizeImportedFile derives a safe title and preserves source text', () => {
  assert.deepEqual(normalizeImportedFile('我的故事.md', '  正文内容  '), {
    title: '我的故事',
    sourceText: '正文内容',
    txtText: '正文内容',
    txtFileName: '我的故事.md'
  });
});
