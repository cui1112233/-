const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
const DIST_DIR = path.join(FRONTEND_DIR, 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');
const SOURCE_MARKER = path.join(DIST_DIR, '.qiantie-source-fingerprint');
const NODE_MODULES_DIR = path.join(FRONTEND_DIR, 'node_modules');
const LOCK_FILE = path.join(FRONTEND_DIR, 'package-lock.json');
const LOCK_MARKER = path.join(NODE_MODULES_DIR, '.qiantie-lock-fingerprint');
const IGNORED_DIRS = new Set(['node_modules', 'dist']);

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectFrontendFiles(dirPath = FRONTEND_DIR, prefix = '') {
  const files = [];
  if (!fs.existsSync(dirPath)) return files;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const absolute = path.join(dirPath, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...collectFrontendFiles(absolute, relative));
    else if (entry.isFile()) files.push({ absolute, relative });
  }
  return files;
}

function frontendSourceFingerprint() {
  const hash = crypto.createHash('sha256');
  for (const file of collectFrontendFiles()) {
    hash.update(file.relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file.absolute));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function readMarker(filePath) {
  try { return fs.readFileSync(filePath, 'utf8').trim(); }
  catch { return ''; }
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runNpm(args, label) {
  console.log(`[frontend] ${label}`);
  const result = spawnSync(npmCommand(), args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}

function ensureFrontendDependencies() {
  if (!fs.existsSync(LOCK_FILE)) throw new Error('frontend/package-lock.json 不存在，无法安装前端依赖');
  const lockFingerprint = hashFile(LOCK_FILE);
  const current = readMarker(LOCK_MARKER);
  if (fs.existsSync(NODE_MODULES_DIR) && current === lockFingerprint) return false;

  runNpm(['ci', '--prefix', 'frontend'], '安装/同步前端依赖');
  fs.mkdirSync(NODE_MODULES_DIR, { recursive: true });
  fs.writeFileSync(LOCK_MARKER, `${lockFingerprint}\n`, 'utf8');
  return true;
}

function ensureFrontendBuild({ force = false } = {}) {
  if (process.env.QIANTIE_FRONTEND_AUTO_BUILD === '0') {
    if (!fs.existsSync(DIST_INDEX)) {
      throw new Error('frontend/dist 不存在且已关闭自动构建（QIANTIE_FRONTEND_AUTO_BUILD=0）');
    }
    return { built: false, skipped: true };
  }

  const sourceFingerprint = frontendSourceFingerprint();
  const currentFingerprint = readMarker(SOURCE_MARKER);
  const fresh = fs.existsSync(DIST_INDEX) && currentFingerprint === sourceFingerprint;
  if (!force && fresh) {
    console.log('[frontend] 构建产物与当前源码一致');
    return { built: false, fingerprint: sourceFingerprint };
  }

  console.log(fs.existsSync(DIST_INDEX)
    ? '[frontend] 检测到源码已更新，正在重建前端…'
    : '[frontend] 未找到可用 dist，正在首次构建前端…');
  ensureFrontendDependencies();
  runNpm(['--prefix', 'frontend', 'run', 'build'], '构建最新前端');

  if (!fs.existsSync(DIST_INDEX)) throw new Error('前端构建完成后仍未生成 frontend/dist/index.html');
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(SOURCE_MARKER, `${sourceFingerprint}\n`, 'utf8');
  console.log('[frontend] 最新账号中心前端已就绪');
  return { built: true, fingerprint: sourceFingerprint };
}

module.exports = {
  ensureFrontendBuild,
  frontendSourceFingerprint,
  collectFrontendFiles,
  DIST_INDEX,
  SOURCE_MARKER
};
