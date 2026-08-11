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
assert(ttsPage.includes('utility-workbench'), 'TTS page should use the shared workbench surface');

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
assert(userLayout.includes('sidebarCollapsed'), 'user layout should keep sidebar collapsed state');
assert(userLayout.includes('toggleSidebar'), 'user layout should provide a sidebar collapse control');
assert(userLayout.includes('THEME_STORAGE_KEY'), 'user layout should persist theme preference');
assert(userLayout.includes('dataset.theme'), 'user layout should sync theme to the document root');
assert(userLayout.includes('toggleTheme'), 'user layout should provide a theme toggle');
assert(userLayout.includes('legacy-theme-toggle'), 'user layout should render the theme toggle control');

const globalCss = read('frontend/src/shared/styles/global.css');
assert(globalCss.includes('.legacy-sidebar'), 'global CSS should style the restored sidebar');
assert(globalCss.includes('.legacy-login-overlay'), 'global CSS should style the restored login overlay');
assert(globalCss.includes('.login-modal'), 'global CSS should style the restored login modal');
assert(globalCss.includes('.home-video-hero'), 'global CSS should style the fullscreen video hero');
assert(globalCss.includes('.home-quick-actions'), 'global CSS should style the restored home quick actions');
assert(globalCss.includes('.script-workbench'), 'global CSS should style the restored script workbench');
assert(globalCss.includes('.tts-card-grid'), 'global CSS should style the restored TTS card layout');
assert(globalCss.includes('.legacy-sidebar.collapsed'), 'global CSS should style collapsed sidebar state');
assert(globalCss.includes('cursor: col-resize'), 'global CSS should expose the script resize affordance');
assert(globalCss.includes("[data-theme='light']"), 'global CSS should define the light theme overrides');
assert(globalCss.includes('flex: 0 0 32px'), 'collapsed navigation icons should keep a fixed visible hit area');
assert(globalCss.includes('.legacy-sidebar.collapsed .legacy-nav-icon'), 'collapsed navigation icons should have dedicated alignment rules');
assert(globalCss.includes('.utility-page'), 'global CSS should style utility pages');
assert(globalCss.includes('.legacy-theme-toggle'), 'global CSS should style the theme switcher');

const scriptPage = read('frontend/src/user/pages/ScriptPage.jsx');
assert(scriptPage.includes('handleResizeStart'), 'script page should start resizing from the divider');
assert(scriptPage.includes('onPointerDown={handleResizeStart}'), 'script divider should handle pointer dragging');
assert(scriptPage.includes('utility-workbench'), 'script page should use the shared workbench surface');
assert(/\bCmLoader\b/.test(scriptPage), 'script page should define the CM loader component');
assert(scriptPage.includes('cm-loader'), 'script page should render the CM loader surface');
assert(scriptPage.includes('role="status"'), 'CM loader should announce generation status');
assert(/output\s*\?\s*\([\s\S]*?\)\s*:\s*loading\s*\?\s*\(\s*<CmLoader\s*\/>\s*\)\s*:\s*\(/.test(scriptPage), 'script output should prioritize output, then CM loader, then empty state');

assert(globalCss.includes('.cm-loader'), 'global CSS should style the CM loader');
assert(/\.cm-loader-dash\s*\{[^}]*cm-loader-dash-array/.test(globalCss), 'global CSS should use CM-prefixed loader keyframes');
assert(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.cm-loader-dash[\s\S]*?animation:\s*none/.test(globalCss), 'CM loader should respect reduced motion');
assert(/try\s*\{\s*await saveHistory\([\s\S]*?\);\s*\}\s*catch\s*\(error\)\s*\{\s*message\.warning\('生成成功，但保存历史失败'\);\s*\}\s*setOutput\(nextOutput\)/.test(scriptPage), 'script page should preserve generated output when history saving fails');
assert(/catch\s*\(error\)\s*\{\s*setOutput\(''\);\s*message\.error/.test(scriptPage), 'script page should clear output when generation fails');

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
assert(settingsPage.includes('utility-page settings-page'), 'settings page should use the shared utility page surface');

const historyPage = read('frontend/src/user/pages/HistoryPage.jsx');
assert(historyPage.includes('listHistory'), 'history page should list generation history');
assert(historyPage.includes('deleteHistory'), 'history page should delete generation history');
assert(historyPage.includes('utility-page history-page'), 'history page should use the shared utility page surface');

const frontendFiles = [
  'frontend/src/user/main.jsx',
  'frontend/src/admin/main.jsx',
  'frontend/src/shared/api/generation.js'
].map(read).join('\n');

assert(!frontendFiles.includes('/api/prompt?file'), 'frontend must not request prompt files');
assert(!frontendFiles.includes('prompts/'), 'frontend source must not reference backend prompt files');

console.log('React frontend architecture validation passed.');
