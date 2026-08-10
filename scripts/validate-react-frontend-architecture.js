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
assert(userLayout.includes('href="/settings"'), 'user navigation should include settings');
assert(userLayout.includes('href="/history"'), 'user navigation should include history');

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
