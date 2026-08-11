const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = process.env.NOVEL_PANEL_V77_SOURCE;
const projectRoot = path.resolve(__dirname, '..');
const workbenchRoot = path.join(projectRoot, 'public', 'novel-panel', 'workbench');

if (!sourceRoot) {
  throw new Error('NOVEL_PANEL_V77_SOURCE must point to the V77 _internal/app directory.');
}

const sourceFiles = [
  ['static/style.css', 'style.css'],
  ['static/app.js', 'app.js'],
  ['static/outline-quality-gate.js', 'outline-quality-gate.js'],
  ['static/character-core/character-core.js', 'character-core/character-core.js']
];

const bridge = `(() => {
  const apiPrefix = '/api/';
  const mountedApiPrefix = '/api/novel-panel/';
  const nativeFetch = window.fetch.bind(window);

  function rewrittenUrl(input) {
    const url = new URL(input, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith(apiPrefix) || url.pathname.startsWith(mountedApiPrefix)) {
      return null;
    }
    url.pathname = mountedApiPrefix + url.pathname.slice(apiPrefix.length);
    return url.toString();
  }

  window.fetch = function novelPanelFetch(input, init = {}) {
    const url = rewrittenUrl(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
    if (!url) return nativeFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    for (const [name, value] of new Headers(init.headers || {})) headers.set(name, value);
    const token = localStorage.getItem('auth_token');
    if (token && !headers.has('Authorization')) headers.set('Authorization', \`Bearer \${token}\`);
    if (input instanceof Request) return nativeFetch(new Request(url, input), { ...init, headers });
    return nativeFetch(url, { ...init, headers });
  };
})();
`;

function rewriteHtml(html) {
  const assetRoot = '/novel-panel/workbench';
  return html
    .replace(/\?v=\{\{\s*asset_version\s*\}\}[^"']*/g, '')
    .replaceAll('/static/character-core/character-core.js', `${assetRoot}/character-core/character-core.js`)
    .replaceAll('/static/outline-quality-gate.js', `${assetRoot}/outline-quality-gate.js`)
    .replaceAll('/static/app.js', `${assetRoot}/app.js`)
    .replaceAll('/static/style.css', `${assetRoot}/style.css`)
    .replace(
      `<script src="${assetRoot}/outline-quality-gate.js"></script>`,
      `<script src="${assetRoot}/bridge.js"></script>\n  <script src="${assetRoot}/outline-quality-gate.js"></script>`
    );
}

function copy(sourceRelativePath, destinationRelativePath) {
  const sourcePath = path.join(sourceRoot, sourceRelativePath);
  const destinationPath = path.join(workbenchRoot, destinationRelativePath);
  if (!fs.existsSync(sourcePath)) throw new Error(`Required V77 source file is missing: ${sourcePath}`);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

fs.rmSync(workbenchRoot, { recursive: true, force: true });
fs.mkdirSync(workbenchRoot, { recursive: true });

const templatePath = path.join(sourceRoot, 'templates', 'index.html');
if (!fs.existsSync(templatePath)) throw new Error(`Required V77 template is missing: ${templatePath}`);
fs.writeFileSync(path.join(workbenchRoot, 'index.html'), rewriteHtml(fs.readFileSync(templatePath, 'utf8')), 'utf8');
for (const [sourceRelativePath, destinationRelativePath] of sourceFiles) copy(sourceRelativePath, destinationRelativePath);
fs.writeFileSync(path.join(workbenchRoot, 'bridge.js'), bridge, 'utf8');

console.log(`Synced V77 novel panel assets to ${path.relative(projectRoot, workbenchRoot)}.`);
