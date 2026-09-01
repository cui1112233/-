import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, name), 'utf8');

test('book settings expose inheritance and restore without copying batch settings', () => {
  const source = read('BatchFactoryV11ScopedSettings.jsx');
  assert.match(source, /当前小说设置/);
  assert.match(source, /继承批次/);
  assert.match(source, /当前层已覆盖/);
  assert.match(source, /恢复全部继承/);
  assert.match(source, /配置版本/);
  assert.match(source, /约束设置/);
});

test('video settings expose highest-level override controls and assets', () => {
  const source = read('BatchFactoryV11ScopedSettings.jsx');
  assert.match(source, /单 VIDEO 设置/);
  assert.match(source, /VIDEO 时长/);
  assert.match(source, /Director revision 是否失效以 Go change-impact 为准/);
  assert.match(source, /负面提示词处理/);
  assert.match(source, /追加/);
  assert.match(source, /完全替换/);
  assert.match(source, /当前 VIDEO 使用资产/);
  assert.match(source, /人物/);
  assert.match(source, /场景/);
  assert.match(source, /道具/);
});

test('publish settings retain the approved original fields and defer 121 connection', () => {
  const source = read('BatchFactoryV11PublishSettings.jsx');
  for (const label of [
    '发布统一设置', '上传视频类型', '合并方式', '滚屏数量', '生成数量', '素材复用', '水平翻转',
    '解压倍速', '解压音调', 'AI头部', 'TXT上传', '121'
  ]) assert.match(source, new RegExp(label));
  assert.match(source, /第三阶段/);
});

test('scoped and publish settings do not import old business APIs', () => {
  const sources = ['BatchFactoryV11ScopedSettings.jsx', 'BatchFactoryV11PublishSettings.jsx']
    .map(name => read(name)).join('\n');
  for (const forbidden of ['shared/api/batchFactory', 'shared/api/shuihuoProduction'])
    assert.equal(sources.includes(forbidden), false, `forbidden legacy source: ${forbidden}`);
  assert.doesNotMatch(sources, /\/api\/batch-factory\/(?!v11(?:\/|['"`]))/);
});
