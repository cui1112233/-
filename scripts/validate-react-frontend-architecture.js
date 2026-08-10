const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function exists(relPath) {
  assert(fs.existsSync(path.join(root, relPath)), `Missing required path: ${relPath}`);
}

function read(relPath) {
  exists(relPath);
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

exists('frontend/package.json');
exists('frontend/index.html');
exists('frontend/admin.html');
exists('frontend/src/user/main.jsx');
exists('frontend/src/admin/main.jsx');
exists('frontend/src/shared/api/client.js');
exists('frontend/src/shared/api/generation.js');
exists('frontend/src/shared/api/tts.js');
exists('frontend/src/shared/layouts/UserLayout.jsx');
exists('frontend/src/shared/layouts/AdminLayout.jsx');
exists('frontend/src/user/pages/SettingsPage.jsx');
exists('frontend/src/user/pages/HistoryPage.jsx');

const generationApi = read('frontend/src/shared/api/generation.js');
assert(generationApi.includes("promptType: 'extract'"), 'generation API should use promptType extract');
assert(generationApi.includes("promptType: 'script'"), 'generation API should use promptType script');
assert(!generationApi.includes('systemPrompt'), 'frontend generation API must not send systemPrompt');

const ttsApi = read('frontend/src/shared/api/tts.js');
assert(ttsApi.includes("apiRequest('/api/tts'"), 'TTS API should call /api/tts through authenticated client');

const ttsPage = read('frontend/src/user/pages/TtsPage.jsx');
assert(ttsPage.includes('textToSpeech'), 'React TTS page should submit text to the TTS API');
assert(ttsPage.includes('<audio'), 'React TTS page should render an audio player for generated speech');

const userApp = read('frontend/src/user/App.jsx');
assert(userApp.includes("pathname === '/settings'"), 'user app should route /settings');
assert(userApp.includes("pathname === '/history'"), 'user app should route /history');

const userLayout = read('frontend/src/shared/layouts/UserLayout.jsx');
assert(userLayout.includes("href: '/settings'"), 'user navigation should include settings');
assert(userLayout.includes("href: '/history'"), 'user navigation should include history');
assert(userLayout.includes('legacy-shell'), 'user layout should use legacy workspace shell');
assert(userLayout.includes('legacy-sidebar'), 'user layout should restore the old sidebar navigation');
assert(userLayout.includes('legacy-login-overlay'), 'user layout should restore the old login overlay');
assert(userLayout.includes('login-modal'), 'user layout should render a login modal');

const globalCss = read('frontend/src/shared/styles/global.css');
assert(globalCss.includes('.legacy-sidebar'), 'global CSS should style the restored sidebar');
assert(globalCss.includes('.legacy-login-overlay'), 'global CSS should style the restored login overlay');
assert(globalCss.includes('.login-modal'), 'global CSS should style the restored login modal');
assert(globalCss.includes('.home-video-hero'), 'global CSS should style the fullscreen video hero');
assert(globalCss.includes('.home-quick-actions'), 'global CSS should style the restored home quick actions');
assert(globalCss.includes('.script-workbench'), 'global CSS should style the restored script workbench');
assert(globalCss.includes('.tts-card-grid'), 'global CSS should style the restored TTS card layout');

const homePage = read('frontend/src/user/pages/HomePage.jsx');
assert(homePage.includes('home-video-hero'), 'React home page should use a fullscreen video hero');
assert(homePage.includes('<video'), 'React home page should render a video background');
assert(homePage.includes('home-hero-nav'), 'React home page should include a hero navigation bar');
assert(homePage.includes('contact-button'), 'React home page should include a contact button');
assert(homePage.includes('quick-action-card'), 'React home page should restore old quick action cards');
assert(homePage.includes('home-recent-section'), 'React home page should restore old recent projects section');

const settingsPage = read('frontend/src/user/pages/SettingsPage.jsx');
assert(settingsPage.includes('getConfig'), 'settings page should load API config');
assert(settingsPage.includes('saveConfig'), 'settings page should save API config');

const historyPage = read('frontend/src/user/pages/HistoryPage.jsx');
assert(historyPage.includes('listHistory'), 'history page should list generation history');
assert(historyPage.includes('deleteHistory'), 'history page should delete generation history');

const frontendFiles = [
  'frontend/src/user/main.jsx',
  'frontend/src/admin/main.jsx',
  'frontend/src/shared/api/generation.js'
].map(read).join('\n');

assert(!frontendFiles.includes('/api/prompt?file'), 'frontend must not request prompt files');
assert(!frontendFiles.includes('prompts/'), 'frontend source must not reference backend prompt files');

console.log('React frontend architecture validation passed.');
