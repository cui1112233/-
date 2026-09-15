const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_RETENTION_DAYS = Object.freeze([7, 14, 30]);
const TERMINAL_STATUSES = new Set(['done', 'completed', 'success', 'submitted', 'skipped_short_original', 'original_done']);
const PROTECTED_SEGMENTS = new Set(['头像', '人物', '场景', '道具', '参考', '上传', '长期素材', '配置', '账号', '会话']);
const PROTECTED_FILE_NAMES = new Set(['project.json', 'config.json', 'manifest.json', 'metadata.json', 'index.json']);
const OUTPUT_ROOTS = new Set(['剧本生成', '小说获取', '改编小说']);
const PROJECT_OUTPUT_DIRS = new Set(['图片', '视频', '剪映', '配音']);

function normalizeProductionRetentionDays(value, fallback = 7) {
  const candidate = Number(value);
  if (ALLOWED_RETENTION_DAYS.includes(candidate)) return candidate;
  return ALLOWED_RETENTION_DAYS.includes(Number(fallback)) ? Number(fallback) : 7;
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status || '').trim().toLowerCase());
}

function isProtectedProductionPath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  const basename = segments.at(-1) || '';
  if (segments.some(segment => PROTECTED_SEGMENTS.has(segment) || /^(?:avatar|reference|upload|config|manifest|metadata)$/i.test(segment))) return true;
  if (PROTECTED_FILE_NAMES.has(basename.toLowerCase())) return true;
  return /(?:^|[-_.])(avatar|reference|uploaded|config|manifest|metadata)(?:[-_.]|$)/i.test(basename);
}

function safeProductionRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return null;
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) return null;
  return resolved;
}

function walkFiles(dir, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(target, output);
    else if (entry.isFile()) output.push(target);
  }
  return output;
}

function allowedProductionFiles(root) {
  const files = [];
  for (const feature of OUTPUT_ROOTS) walkFiles(path.join(root, feature), files);
  const productionRoot = path.join(root, '制作工程');
  if (fs.existsSync(productionRoot)) {
    for (const project of fs.readdirSync(productionRoot, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      for (const outputDir of PROJECT_OUTPUT_DIRS) walkFiles(path.join(productionRoot, project.name, outputDir), files);
    }
  }
  return files;
}

function readStateFor(file) {
  const statePath = `${file}.state.json`;
  if (!fs.existsSync(statePath)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return state && typeof state === 'object' ? state : null;
  } catch {
    return { status: 'unknown' };
  }
}

function planLocalProductionCleanup({ root, retentionDays = 7, now = new Date() } = {}) {
  const resolvedRoot = safeProductionRoot(root);
  if (!resolvedRoot) return { root: null, retentionDays: normalizeProductionRetentionDays(retentionDays), cutoff: new Date(now).getTime(), files: [], skipped: 0 };
  const days = normalizeProductionRetentionDays(retentionDays);
  const cutoff = new Date(now).getTime() - days * 24 * 60 * 60 * 1000;
  const files = [];
  let skipped = 0;
  for (const file of allowedProductionFiles(resolvedRoot)) {
    const relativePath = path.relative(resolvedRoot, file).replaceAll('\\', '/');
    if (relativePath.endsWith('.state.json') || isProtectedProductionPath(relativePath)) { skipped += 1; continue; }
    const state = readStateFor(file);
    if (state && !isTerminalStatus(state.status)) { skipped += 1; continue; }
    let stat;
    try { stat = fs.statSync(file); } catch { skipped += 1; continue; }
    if (stat.mtimeMs >= cutoff) { skipped += 1; continue; }
    files.push({ file, relativePath, mtimeMs: stat.mtimeMs });
  }
  return { root: resolvedRoot, retentionDays: days, cutoff, files, skipped };
}

function executeLocalProductionCleanup(plan, { dryRun = false } = {}) {
  const result = { deleted: 0, skipped: Number(plan?.skipped || 0), failed: 0, errors: [] };
  for (const item of Array.isArray(plan?.files) ? plan.files : []) {
    if (dryRun) { result.skipped += 1; continue; }
    try {
      fs.unlinkSync(item.file);
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(`${item.relativePath}: ${error.message}`);
    }
  }
  return result;
}

function createTosProductionCleaner({ listObjects, deleteObject, now = () => Date.now() } = {}) {
  if (typeof listObjects !== 'function' || typeof deleteObject !== 'function') return null;
  return async ({ username = '', retentionDays = 7, dryRun = false } = {}) => {
    const cutoff = now() - normalizeProductionRetentionDays(retentionDays) * 24 * 60 * 60 * 1000;
    const prefix = username ? `production/${String(username).replace(/[^a-zA-Z0-9_-]/g, '')}/` : 'production/';
    const objects = await listObjects();
    const result = { deleted: 0, skipped: 0, failed: 0, errors: [] };
    for (const object of Array.isArray(objects) ? objects : []) {
      const key = String(object?.key || object?.Key || '');
      const lastModified = new Date(object?.lastModified || object?.LastModified || 0).getTime();
      const completed = object?.completed === true || isTerminalStatus(object?.status);
      if (!key || !key.startsWith(prefix) || isProtectedProductionPath(key) || !completed || !Number.isFinite(lastModified) || lastModified >= cutoff) { result.skipped += 1; continue; }
      if (dryRun) { result.skipped += 1; continue; }
      try { await deleteObject(key); result.deleted += 1; } catch (error) { result.failed += 1; result.errors.push(`${key}: ${error.message}`); }
    }
    return result;
  };
}

module.exports = {
  ALLOWED_RETENTION_DAYS,
  TERMINAL_STATUSES,
  normalizeProductionRetentionDays,
  isTerminalStatus,
  isProtectedProductionPath,
  planLocalProductionCleanup,
  executeLocalProductionCleanup,
  createTosProductionCleaner
};
