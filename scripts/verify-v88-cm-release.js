const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceOnly = process.argv.includes('--source-only');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertFile(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert(fs.existsSync(absolutePath), `missing required file: ${relativePath}`);
  assert(fs.statSync(absolutePath).size > 0, `required file is empty: ${relativePath}`);
}

function filesIn(relativeDir, suffix) {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  return fs.readdirSync(absoluteDir)
    .filter(name => name.endsWith(suffix))
    .map(name => path.join(absoluteDir, name));
}

function anyFileContains(files, needle) {
  return files.some(file => fs.readFileSync(file, 'utf8').includes(needle));
}

const layout = read('frontend/src/shared/layouts/UserLayout.jsx');
const userApp = read('frontend/src/user/App.jsx');
const homeRoutePath = 'frontend/src/user/pages/HomeRoute.jsx';
const homeRoute = exists(homeRoutePath) ? read(homeRoutePath) : '';
const companion = read('frontend/src/shared/pet/CmPenguinCompanion.jsx');
const petCatalog = read('frontend/src/shared/pet/petCatalog.js');
const companionCss = read('frontend/src/shared/pet/cm-penguin-companion.css');
const dockerfile = read('Dockerfile');

const layoutCoversHome = layout.includes('{isLoggedIn && petVisible ? <CmPenguinCompanion');
const homeRouteCoversHome = userApp.includes('HomeRoute')
  && homeRoute.includes('<CmPenguinCompanion')
  && homeRoute.includes('getConfig()')
  && homeRoute.includes('petVisible')
  && homeRoute.includes('isLoggedIn');

assert(
  layout.includes('<CmPenguinCompanion'),
  'business workspace must keep the CM companion mount'
);
assert(
  layoutCoversHome || homeRouteCoversHome,
  'logged-in home page must render CM while respecting the saved pet visibility setting'
);
assert(
  companion.includes('pet.spritesheetPath'),
  'pet renderer must use the selected pet spritesheet from the catalog'
);
assert(
  petCatalog.includes('/pets/stacky/spritesheet.webp'),
  'pet catalog must keep the CM/Stacky spritesheet'
);
assert(
  petCatalog.includes('/pets/pixiu/spritesheet.webp'),
  'pet catalog must keep the Pixiu spritesheet'
);
assert(
  companionCss.includes('.cm-penguin-shell'),
  'CM stylesheet must contain the companion shell rules'
);
assertFile('pets/stacky/spritesheet.webp');
assertFile('pets/pixiu/spritesheet.webp');
assert(
  dockerfile.includes('COPY pets/ ./pets/'),
  'Docker image must copy the pets directory'
);
assert(
  dockerfile.includes('COPY frontend/dist/ ./frontend/dist/'),
  'Docker image must copy the built frontend'
);

if (!sourceOnly) {
  assertFile('frontend/dist/index.html');
  const jsFiles = filesIn('frontend/dist/assets', '.js');
  const cssFiles = filesIn('frontend/dist/assets', '.css');
  assert(jsFiles.length > 0, 'frontend build produced no JavaScript assets');
  assert(cssFiles.length > 0, 'frontend build produced no CSS assets');
  assert(
    anyFileContains(jsFiles, '/pets/stacky/spritesheet.webp'),
    'built frontend does not contain the CM/Stacky spritesheet reference'
  );
  assert(
    anyFileContains(jsFiles, '/pets/pixiu/spritesheet.webp'),
    'built frontend does not contain the Pixiu spritesheet reference'
  );
  assert(
    anyFileContains(cssFiles, '.cm-penguin-shell'),
    'built frontend does not contain CM companion styles'
  );
}

console.log(`V88 CM release contract passed (${sourceOnly ? 'source' : 'build'} mode).`);
