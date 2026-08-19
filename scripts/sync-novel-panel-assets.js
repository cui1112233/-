const fs = require('node:fs');
const path = require('node:path');

// Source root must point to the V78.3.0.2 `_internal/app` directory
// (e.g. the extracted zip). The legacy env name is retained for compatibility.
const sourceRoot = process.env.NOVEL_PANEL_V77_SOURCE || process.env.NOVEL_PANEL_V78_SOURCE;
const projectRoot = path.resolve(__dirname, '..');
const workbenchRoot = path.join(projectRoot, 'public', 'novel-panel', 'workbench');
const bridgeTemplate = path.join(__dirname, 'novel-panel-bridge.js');

if (!sourceRoot) {
  throw new Error('NOVEL_PANEL_V78_SOURCE (or NOVEL_PANEL_V77_SOURCE) must point to the V78.3.0.2 _internal/app directory.');
}

const V78_VERSION = 'v78.3.0.2';

// Source asset pairs: [sourceRelativePath, destinationRelativePath]
const sourceFiles = [
  ['static/style.css', 'style.css'],
  ['static/app.js', 'app.js'],
  ['static/character-core/character-core.js', 'character-core/character-core.js']
];

function requiredSourcePath(relativePath) {
  const sourcePath = path.join(sourceRoot, relativePath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Required V78 source file is missing: ${sourcePath}`);
  }
  return sourcePath;
}

function cleanCoreModules() {
  const cleanCoreSource = path.join(sourceRoot, 'static', 'clean-core');
  if (!fs.existsSync(cleanCoreSource) || !fs.statSync(cleanCoreSource).isDirectory()) {
    throw new Error(`Required V78 clean-core directory is missing: ${cleanCoreSource}`);
  }
  return fs.readdirSync(cleanCoreSource)
    .filter(name => name.endsWith('.js'))
    .sort();
}

function rewriteHtml(html) {
  const assetRoot = '/novel-panel/workbench';
  return html
    // Remove service worker / cache cleanup (browser API unavailable inside the sandboxed frame).
    .replace(/[ \t]*if \("serviceWorker" in navigator\)[\s\S]*?\.catch\(\(\) => \{\}\);\s*[ \t]*if \("caches" in window\)[\s\S]*?\.catch\(\(\) => \{\}\);/g, '')
    // Strip source-only version suffix: ?v={{ asset_version }}-...
    .replace(/\?v=\{\{\s*asset_version\s*\}\}[^"']*/g, '')
    // Rewrite static asset paths to the qiantie-hosted workbench root.
    .replaceAll('/static/clean-core/', `${assetRoot}/clean-core/`)
    .replaceAll('/static/character-core/', `${assetRoot}/character-core/`)
    .replaceAll('/static/app.js', `${assetRoot}/app.js`)
    .replaceAll('/static/style.css', `${assetRoot}/style.css`)
    // Inject the authenticated API bridge before the first app script.
    .replace(
      `<script src="${assetRoot}/app.js"></script>`,
      `<script src="${assetRoot}/bridge.js"></script>\n  <script src="${assetRoot}/app.js"></script>`
    );
}

function validateTransformedHtml(html) {
  const assetRoot = '/novel-panel/workbench';
  const expectedReferences = [
    `${assetRoot}/style.css`,
    `${assetRoot}/app.js`,
    `${assetRoot}/character-core/character-core.js`
  ];
  for (const reference of expectedReferences) {
    if (!html.includes(reference)) throw new Error(`Transformed V78 HTML is missing ${reference}.`);
  }
  const bridgeReferences = html.match(/src=["']\/novel-panel\/workbench\/bridge\.js["']/g) || [];
  if (bridgeReferences.length !== 1) throw new Error('Transformed V78 HTML must include exactly one bridge script.');
  const modules = cleanCoreModules();
  for (const moduleName of modules) {
    if (!html.includes(`${assetRoot}/clean-core/${moduleName}`)) {
      throw new Error(`Transformed V78 HTML is missing clean-core module: ${moduleName}`);
    }
  }
  if (html.includes('outline-quality-gate.js')) {
    throw new Error('Transformed V78 HTML must not reference outline-quality-gate.js.');
  }
  if (/\{\{\s*asset_version\s*\}\}|navigator\.serviceWorker\.getRegistrations|caches\.keys/.test(html)) {
    throw new Error('Transformed V78 HTML contains forbidden source-only markers.');
  }
}

// The sandboxed workbench iframe can only reach the same origin (CSP
// connect-src 'self'). Route TTS through the authenticated qiantie proxy
// instead of the stock external endpoint.
function rewriteAppJs(source) {
  return source.replace(
    'const TTS_API_URL = "http://tts2.121w.com/v1/audio/speech";',
    'const TTS_API_URL = "/api/tts";'
  );
}

function validateTransformedAppJs(source) {
  if (!source.includes('const TTS_API_URL = "/api/tts";')) {
    throw new Error('Transformed V78 app.js is missing the same-origin TTS proxy constant.');
  }
  if (source.includes('http://tts2.121w.com/v1/audio/speech')) {
    throw new Error('Transformed V78 app.js still references the external TTS endpoint.');
  }
}

function copy(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

function copyTree(sourceDir, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourceEntry = path.join(sourceDir, entry.name);
    const destinationEntry = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(sourceEntry, destinationEntry);
    } else if (entry.isFile()) {
      copy(sourceEntry, destinationEntry);
    }
  }
}

function replaceWorkbench(stagingRoot) {
  const backupRoot = `${workbenchRoot}.backup-${process.pid}-${Date.now()}`;
  let movedExisting = false;
  try {
    if (fs.existsSync(workbenchRoot)) {
      fs.renameSync(workbenchRoot, backupRoot);
      movedExisting = true;
    }
    try {
      fs.renameSync(stagingRoot, workbenchRoot);
    } catch (error) {
      if (movedExisting && fs.existsSync(backupRoot) && !fs.existsSync(workbenchRoot)) {
        fs.renameSync(backupRoot, workbenchRoot);
      }
      throw error;
    }
    if (movedExisting) fs.rmSync(backupRoot, { recursive: true, force: true });
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    if (fs.existsSync(backupRoot) && fs.existsSync(workbenchRoot)) {
      fs.rmSync(backupRoot, { recursive: true, force: true });
    }
  }
}

const templatePath = requiredSourcePath('templates/index.html');
const verifiedSources = sourceFiles.map(([sourceRelativePath, destinationRelativePath]) => [
  requiredSourcePath(sourceRelativePath),
  destinationRelativePath
]);
if (!fs.existsSync(bridgeTemplate) || !fs.statSync(bridgeTemplate).isFile()) {
  throw new Error(`Bridge template is missing: ${bridgeTemplate}`);
}
const appJsSource = rewriteAppJs(fs.readFileSync(requiredSourcePath('static/app.js'), 'utf8'));
validateTransformedAppJs(appJsSource);
const transformedHtml = rewriteHtml(fs.readFileSync(templatePath, 'utf8'));
validateTransformedHtml(transformedHtml);
const stagingRoot = `${workbenchRoot}.staging-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

try {
  fs.mkdirSync(stagingRoot, { recursive: true });
  fs.writeFileSync(path.join(stagingRoot, 'index.html'), transformedHtml, 'utf8');
  for (const [sourcePath, destinationRelativePath] of verifiedSources) {
    if (destinationRelativePath === 'app.js') {
      fs.writeFileSync(path.join(stagingRoot, 'app.js'), appJsSource, 'utf8');
    } else {
      copy(sourcePath, path.join(stagingRoot, destinationRelativePath));
    }
  }
  copyTree(
    path.join(sourceRoot, 'static', 'clean-core'),
    path.join(stagingRoot, 'clean-core')
  );
  copy(bridgeTemplate, path.join(stagingRoot, 'bridge.js'));
  replaceWorkbench(stagingRoot);
} catch (error) {
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  throw error;
}

console.log(`Synced V78.3.0.2 novel panel assets to ${path.relative(projectRoot, workbenchRoot)}.`);
