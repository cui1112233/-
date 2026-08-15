const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const createModalPath = path.join(root, 'frontend', 'src', 'user', 'pages', 'shuihuo', 'CreateProjectModal.jsx');
const pagePath = path.join(root, 'frontend', 'src', 'user', 'pages', 'ShuihuoProductionPage.jsx');
const apiPath = path.join(root, 'frontend', 'src', 'shared', 'api', 'shuihuoProduction.js');

test('create project modal includes name, file upload, paste, and dialogue mode', () => {
  const modal = fs.readFileSync(createModalPath, 'utf8');
  assert.match(modal, /作品名称/);
  assert.match(modal, /上传小说文件/);
  assert.match(modal, /粘贴小说内容/);
  assert.match(modal, /对话模式/);
  assert.match(modal, /自动识别/);
  assert.match(modal, /中文双对话/);
  assert.match(modal, /accept="\.txt,\.srt,\.vtt"/);
});

test('shuihuo page wires the create modal and dialogue mode into creation', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const api = fs.readFileSync(apiPath, 'utf8');
  assert.match(page, /CreateProjectModal/);
  assert.match(page, /dialogueMode/);
  assert.match(api, /export function smartSegmentation/);
});

test('project home renders comic creation, search, filter, and sorting controls', () => {
  const projectsView = fs.readFileSync(path.join(root, 'frontend', 'src', 'user', 'pages', 'shuihuo', 'ProjectsView.jsx'), 'utf8');
  assert.match(projectsView, /创建漫剧/);
  assert.match(projectsView, /搜索作品名称/);
  assert.match(projectsView, /全部状态/);
  assert.match(projectsView, /最近更新/);
});
