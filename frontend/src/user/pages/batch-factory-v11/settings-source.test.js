import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, name), 'utf8');

test('production settings drawer keeps the approved section order', () => {
  const source = read('BatchFactoryV11SettingsDrawers.jsx');
  const configIndex = source.indexOf('配置版本');
  const basicIndex = source.indexOf('基础生产设置');
  const constraintIndex = source.indexOf('约束设置');
  assert.ok(configIndex >= 0);
  assert.ok(basicIndex > configIndex);
  assert.ok(constraintIndex > basicIndex);
  const width = Number(source.match(/width={(\d+)}/)?.[1] || 0);
  assert.ok(width >= 720 && width <= 860, `drawer width ${width} is outside the approved range`);
  assert.match(source, /同步批量后台配置/);
});

test('inline constraints expose editors directly under enabled switches', () => {
  const source = read('BatchFactoryV11ConstraintEditor.jsx');
  for (const label of ['画面前缀词', '画质约束', '画面限制', '负面提示词']) assert.match(source, new RegExp(label));
  assert.match(source, /系统预设/);
  assert.match(source, /我的提示词/);
  assert.match(source, /当前草稿/);
  assert.match(source, /保存当前草稿/);
  assert.match(source, /保存为我的提示词/);
  assert.equal(source.includes('Pencil'), false);
  assert.equal(source.includes('编辑按钮'), false);
});

test('constraint selectors are backed by real personal-center prompt records', () => {
  const drawer = read('BatchFactoryV11SettingsDrawers.jsx');
  const editor = read('BatchFactoryV11ConstraintEditor.jsx');
  assert.match(drawer, /personalPrompts/);
  assert.match(editor, /personalPrompts/);
  assert.match(editor, /personalOptions/);
  assert.doesNotMatch(editor, /personal-\$\{key\}/);
});

test('personal prompt copy describes the actual persistence boundary', () => {
  const editor = read('BatchFactoryV11ConstraintEditor.jsx');
  assert.match(editor, /保存到个人中心/);
  assert.doesNotMatch(editor, /也会写入 V11 Prompt\/Draft 库/);
});

test('settings UI stays detached from legacy business APIs', () => {
  const sources = ['BatchFactoryV11SettingsDrawers.jsx', 'BatchFactoryV11ConstraintEditor.jsx']
    .map(name => read(name)).join('\n');
  for (const forbidden of ['shared/api/batchFactory', 'shared/api/shuihuoProduction'])
    assert.equal(sources.includes(forbidden), false, `forbidden legacy source: ${forbidden}`);
  assert.doesNotMatch(sources, /\/api\/batch-factory\/(?!v11(?:\/|['"`]))/);
});
