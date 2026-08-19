// lib/storage-root.js
const path = require('node:path');
const fs = require('node:fs');
const { readConfig } = require('./shared');

const FEATURE_SCRIPT = '剧本生成';
const FEATURE_NOVEL_FETCH = '小说获取';
const FEATURE_NOVEL_ADAPT = '改编小说';
const FEATURE_PRODUCTION = '制作工程';

function sanitizeProjectName(name) {
  const cleaned = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_');
  return cleaned || '未命名项目';
}

function getStorageRoot(username, readConfigFn = readConfig) {
  const config = readConfigFn(username);
  const root = typeof config.storageRoot === 'string' ? config.storageRoot.trim() : '';
  return root || null;
}

function featureDir(root, feature) {
  const dir = path.join(root, feature);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function projectDir(root, projectName) {
  const dir = path.join(root, FEATURE_PRODUCTION, sanitizeProjectName(projectName));
  fs.mkdirSync(dir, { recursive: true });
  for (const sub of ['图片', '视频', '剪映', '配音']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  return dir;
}

function normalizeStorageRoot(value) {
  const cleaned = String(value == null ? '' : value).trim();
  if (cleaned === '') return { value: '', error: undefined };
  if (!path.isAbsolute(cleaned)) return { value: cleaned, error: '本地存储文件夹必须是绝对路径，或留空以关闭' };
  try {
    fs.mkdirSync(cleaned, { recursive: true });
    return { value: cleaned, error: undefined };
  } catch (error) {
    return { value: cleaned, error: `无法创建本地存储文件夹：${error.message}` };
  }
}

function buildScriptMd(history) {
  const title = String(history.title || history.id || '剧本').replace(/^#+\s*/, '').trim() || '剧本';
  const header = `格式：${history.format || ''}　模式：${history.mode || ''}　时长：${history.duration || ''}`;
  const when = history.createdAt ? `　生成时间：${new Date(history.createdAt).toLocaleString('zh-CN')}` : '';
  return [`# ${title}`, '', `> ${header}${when}`, '', String(history.output || '')].join('\n');
}

function writeScriptResultMd(root, history) {
  if (!root || !history) return null;
  const dir = featureDir(root, FEATURE_SCRIPT);
  const file = path.join(dir, `${history.id}.md`);
  fs.writeFileSync(file, buildScriptMd(history), 'utf8');
  return file;
}

function writeNovelFetchResult(root, feature, bookId, data) {
  if (!root || !bookId) return false;
  try {
    fs.writeFileSync(path.join(featureDir(root, feature), `${bookId}.txt`), String(data ?? ''), 'utf8');
    return true;
  } catch (_) { return false; }
}

function buildNovelPanelExportMd(project) {
  const name = String(project && project.name ? project.name : '未命名项目');
  const segments = (project && project.data && Array.isArray(project.data.final_segments)) ? project.data.final_segments : [];
  const body = segments.map((s, i) => `## 第 ${i + 1} 段\n\n${s.finalText || s.sourceText || ''}`).join('\n\n');
  return [`# ${name}　输出结果`, '', body].join('\n');
}

function writeNovelPanelExport(root, project) {
  if (!root || !project) return null;
  const dir = projectDir(root, project.name);
  const file = path.join(dir, '输出结果.md');
  fs.writeFileSync(file, buildNovelPanelExportMd(project), 'utf8');
  return file;
}

function saveDubbingAudio(root, projectName, buffer, ext = 'mp3') {
  if (!root || !projectName || !buffer) return null;
  try {
    const dir = path.join(projectDir(root, projectName), '配音');
    const file = path.join(dir, `${Date.now()}.${ext}`);
    fs.writeFileSync(file, buffer);
    return file;
  } catch (_) { return null; }
}

function scanDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => ({ name: e.name, size: fs.statSync(path.join(dir, e.name)).size }));
}

function scanStorage(root) {
  const productionRoot = path.join(root, FEATURE_PRODUCTION);
  const projects = [];
  if (fs.existsSync(productionRoot)) {
    for (const entry of fs.readdirSync(productionRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      projects.push({ name: entry.name, files: scanDir(path.join(productionRoot, entry.name)) });
    }
  }
  return {
    scriptResults: scanDir(path.join(root, FEATURE_SCRIPT)),
    novelFetch: scanDir(path.join(root, FEATURE_NOVEL_FETCH)),
    novelAdapt: scanDir(path.join(root, FEATURE_NOVEL_ADAPT)),
    projects
  };
}

module.exports = { FEATURE_SCRIPT, FEATURE_NOVEL_FETCH, FEATURE_NOVEL_ADAPT, FEATURE_PRODUCTION, sanitizeProjectName, getStorageRoot, featureDir, projectDir, normalizeStorageRoot, buildScriptMd, writeScriptResultMd, writeNovelFetchResult, buildNovelPanelExportMd, writeNovelPanelExport, saveDubbingAudio, scanDir, scanStorage };
