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

function readCssBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert(markerIndex !== -1, `Missing CSS block marker: ${marker}`);

  const blockStart = source.indexOf('{', markerIndex + marker.length);
  assert(blockStart !== -1, `Missing CSS block opening brace: ${marker}`);

  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(markerIndex, index + 1);
    }
  }

  assert.fail(`Unclosed CSS block: ${marker}`);
}

exists('frontend/package.json');
exists('frontend/index.html');
exists('frontend/admin.html');
exists('frontend/src/user/main.jsx');
exists('frontend/src/admin/main.jsx');
exists('frontend/src/shared/api/client.js');
exists('frontend/src/shared/api/generation.js');
exists('frontend/src/shared/api/tts.js');
exists('frontend/src/shared/components/BrandLogo.jsx');
exists('frontend/src/shared/layouts/UserLayout.jsx');
exists('frontend/src/shared/layouts/AdminLayout.jsx');
exists('frontend/src/user/pages/SettingsPage.jsx');
exists('frontend/src/user/pages/HistoryPage.jsx');
exists('public/assets/brand-logo-black.png');
exists('public/assets/brand-logo-white.png');

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
assert(/const SettingsPage = lazy\([\s\S]*?\.\/pages\/SettingsPage/.test(userApp), 'user app should lazy load settings');
assert(/const HistoryPage = lazy\([\s\S]*?\.\/pages\/HistoryPage/.test(userApp), 'user app should lazy load history');
assert(/const AgentPage = lazy\([\s\S]*?\.\/pages\/AgentPage/.test(userApp), 'user app should lazy load agent');
assert(/const routes = \{[\s\S]*?'\/agent': AgentPage/.test(userApp), 'user app should map /agent through the route map');
assert(/const routes = \{[\s\S]*?'\/settings': SettingsPage/.test(userApp), 'user app should map /settings through the route map');
assert(/const routes = \{[\s\S]*?'\/history': HistoryPage/.test(userApp), 'user app should map /history through the route map');
assert(userApp.includes('const Page = routes[pathname];'), 'user app should resolve pages from the route map');
assert(/<Suspense[\s\S]*?<Page \/>/.test(userApp), 'user app should render lazy routes through suspense');

const userLayout = read('frontend/src/shared/layouts/UserLayout.jsx');
const adminLayout = read('frontend/src/shared/layouts/AdminLayout.jsx');
const authApi = read('frontend/src/shared/api/auth.js');
const brandLogo = read('frontend/src/shared/components/BrandLogo.jsx');
assert(brandLogo.includes('/assets/brand-logo-black.png') && brandLogo.includes('/assets/brand-logo-white.png'), 'brand logo component should include both supplied logo variants');
assert(userLayout.includes('<BrandLogo className="legacy-brand-logo" />'), 'feature-page sidebar should render the supplied brand logo');
assert(userLayout.includes('href="/settings"'), 'user sidebar should include settings');
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
assert(userLayout.includes('user-theme-active'), 'user layout should mark body while portal components are active');
assert(userLayout.includes('legacy-nav-tooltip'), 'user navigation should render decorative tooltip labels for collapsed links');
assert(authApi.includes("apiRequest('/api/login/session')"), 'auth API should refresh the current server-side session metadata');
assert(userLayout.includes('getCurrentAccount'), 'user layout should refresh current account metadata before rendering privileged navigation');
assert(userLayout.includes("href=\"/admin/presets\""), 'user sidebar should provide an admin entry point');
assert(userLayout.includes('canAccessAdmin'), 'user sidebar should gate the admin entry point by refreshed permissions');
assert(/<Link href="\/admin\/presets"[^>]*reload/.test(userLayout), 'admin entry should use a full document navigation to the admin bundle');

const globalCss = read('frontend/src/shared/styles/global.css');
assert(adminLayout.includes("'yizhan-theme'"), 'admin layout should reuse the shared theme preference');
assert(adminLayout.includes('dataset.theme'), 'admin layout should sync the shared theme to the document root');
assert(adminLayout.includes('admin-theme-active'), 'admin layout should mark body while admin portal components are open');
assert(globalCss.includes("[data-theme='light'] .admin-shell"), 'admin shell should define readable light theme overrides');
assert(globalCss.includes('.admin-theme-active .ant-drawer-content'), 'admin drawer portals should receive the active admin theme');
assert(globalCss.includes('.admin-theme-active .ant-select-dropdown'), 'admin select dropdown portals should receive the active admin theme');
assert(globalCss.includes('.admin-theme-active .ant-input-status-success'), 'admin validation-state inputs should retain the active admin theme');
assert(globalCss.includes('input:-webkit-autofill'), 'admin autofilled inputs should retain readable theme colors');
const defaultTooltipRule = readCssBlock(globalCss, '\n.legacy-nav-tooltip {');
assert(defaultTooltipRule.includes('display: none'), 'expanded navigation tooltip labels should be hidden by default');
const collapsedNavLabelCss = readCssBlock(globalCss, '.legacy-sidebar.collapsed .legacy-nav-label');
assert(collapsedNavLabelCss.includes('position: absolute') && collapsedNavLabelCss.includes('width: 1px') && collapsedNavLabelCss.includes('height: 1px') && collapsedNavLabelCss.includes('overflow: hidden') && collapsedNavLabelCss.includes('clip: rect(0, 0, 0, 0)') && collapsedNavLabelCss.includes('white-space: nowrap'), 'collapsed navigation labels should remain visually hidden for screen readers');
assert(!collapsedNavLabelCss.includes('display: none'), 'collapsed navigation labels should remain available to screen readers');
assert(globalCss.includes('.legacy-sidebar.collapsed .legacy-nav-tooltip'), 'global CSS should style collapsed navigation tooltip labels');
const collapsedNavLinkCss = readCssBlock(globalCss, '.legacy-sidebar.collapsed .legacy-nav a');
assert(collapsedNavLinkCss.includes('width: 50px') && collapsedNavLinkCss.includes('min-height: 50px') && collapsedNavLinkCss.includes('border-radius: 50%'), 'collapsed navigation links should remain circular 50px controls');
assert(collapsedNavLinkCss.includes('height: 50px'), 'collapsed navigation links should keep a 50px height');
assert(/(?:^|[;{])\s*height:\s*50px\s*;/m.test(collapsedNavLinkCss), 'collapsed navigation links should keep a 50px height');
const collapsedNavIconRule = readCssBlock(globalCss, '.legacy-sidebar.collapsed .legacy-nav-icon');
assert(collapsedNavIconRule.includes('width: 50px') && collapsedNavIconRule.includes('height: 50px') && collapsedNavIconRule.includes('border-radius: 50%'), 'collapsed navigation icons should remain circular 50px controls');
const collapsedTooltipRule = readCssBlock(globalCss, '.legacy-sidebar.collapsed .legacy-nav-tooltip');
assert(collapsedTooltipRule.includes('opacity: 0') && collapsedTooltipRule.includes('transform: scaleX(0.35)') && collapsedTooltipRule.includes('pointer-events: none'), 'collapsed navigation tooltip should be initially hidden without intercepting work-area clicks');
assert(globalCss.includes('.legacy-sidebar.collapsed .legacy-nav a:focus-visible .legacy-nav-tooltip'), 'collapsed navigation tooltip should be visible for keyboard focus');
const tooltipVisibilityRule = readCssBlock(globalCss, '.legacy-sidebar.collapsed .legacy-nav a:hover .legacy-nav-tooltip');
assert(tooltipVisibilityRule.includes('.legacy-sidebar.collapsed .legacy-nav a:hover .legacy-nav-tooltip') && tooltipVisibilityRule.includes('.legacy-sidebar.collapsed .legacy-nav a:focus-visible .legacy-nav-tooltip') && !tooltipVisibilityRule.includes('.legacy-sidebar.collapsed .legacy-nav a.active .legacy-nav-tooltip') && tooltipVisibilityRule.includes('opacity: 1') && tooltipVisibilityRule.includes('transform: scaleX(1)'), 'collapsed navigation tooltip should reveal only for hover and keyboard focus, not the active route');
const activeNavIconRule = readCssBlock(globalCss, '.legacy-sidebar.collapsed .legacy-nav a.active .legacy-nav-icon');
assert(activeNavIconRule.includes('background: linear-gradient'), 'active collapsed navigation icon should use the gradient treatment');
const expandedActiveNavRule = readCssBlock(globalCss, '.legacy-sidebar:not(.collapsed) .legacy-nav a.active');
assert(expandedActiveNavRule.includes('background: linear-gradient') && expandedActiveNavRule.includes('color: #fff'), 'active expanded navigation should retain the colored gradient treatment');
const focusedNavLinkRule = readCssBlock(globalCss, '\n.legacy-sidebar.collapsed .legacy-nav a:focus-visible {');
assert(focusedNavLinkRule.includes('outline:'), 'collapsed navigation links should retain a visible keyboard focus outline');
const reducedMotionCss = readCssBlock(globalCss, '@media (prefers-reduced-motion: reduce)');
const reducedMotionTooltipCss = readCssBlock(reducedMotionCss, '.legacy-sidebar.collapsed .legacy-nav-tooltip');
assert(reducedMotionTooltipCss.includes('transition: none') && reducedMotionTooltipCss.includes('transform: none'), 'reduced motion CSS should disable collapsed navigation tooltip movement');
const reducedMotionVisibleTooltipCss = readCssBlock(reducedMotionCss, '.legacy-sidebar.collapsed .legacy-nav a:hover .legacy-nav-tooltip');
assert(reducedMotionVisibleTooltipCss.includes('transition: none') && reducedMotionVisibleTooltipCss.includes('transform: none') && !reducedMotionVisibleTooltipCss.includes('.legacy-sidebar.collapsed .legacy-nav a.active .legacy-nav-tooltip'), 'reduced motion CSS should disable hover and focus tooltip movement without keeping active labels expanded');
assert(!globalCss.includes('.legacy-shell:has(.legacy-sidebar.collapsed .legacy-nav a:hover) .legacy-main'), 'desktop navigation tooltip should not shift the main work area');
assert(collapsedTooltipRule.includes('pointer-events: none'), 'desktop navigation tooltip should not intercept work-area clicks while hidden');
const compactCss = readCssBlock(globalCss, '@media (max-width: 900px)');
const compactTooltipCss = readCssBlock(compactCss, '.legacy-sidebar.collapsed .legacy-nav-tooltip');
assert(compactTooltipCss.includes('display: none'), 'compact navigation CSS should hide collapsed navigation tooltip labels');
const compactNavLabelCss = readCssBlock(compactCss, '\n  .legacy-nav-label {');
assert(compactNavLabelCss.includes('position: absolute') && compactNavLabelCss.includes('width: 1px') && compactNavLabelCss.includes('height: 1px') && compactNavLabelCss.includes('overflow: hidden') && compactNavLabelCss.includes('clip: rect(0, 0, 0, 0)') && compactNavLabelCss.includes('white-space: nowrap'), 'compact navigation labels should remain visually hidden for screen readers');
assert(!compactNavLabelCss.includes('display: none'), 'compact navigation labels should remain available to screen readers');
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
assert(scriptPage.includes('data-letter="C"') && scriptPage.includes('data-letter="M"'), 'CM loader should render C and M letter paths');
assert(/output\s*\?\s*\([\s\S]*?\)\s*:\s*generating\s*\?\s*\(\s*<CmLoader\s*\/>\s*\)\s*:\s*\(/.test(scriptPage), 'script output should prioritize output, then generation loader, then empty state');
assert(scriptPage.includes('const [extracting, setExtracting] = useState(false);'), 'script page should track extraction independently');
assert(scriptPage.includes('const [generating, setGenerating] = useState(false);'), 'script page should track generation independently');
assert(scriptPage.includes('loading={extracting}'), 'extraction button should only show extraction loading');
assert(scriptPage.includes('loading={generating}'), 'generation button should only show generation loading');
assert(globalCss.includes('.script-output .legacy-output'), 'script output should stretch its textarea through the available work area');
assert(scriptPage.includes('rootClassName="entity-editor-modal"'), 'entity editor should expose a dedicated modal class for contrast-safe styling');
assert(globalCss.includes('.entity-editor-modal .ant-modal-content'), 'entity editor modal should define its own surface color');
assert(globalCss.includes('.entity-editor-modal .ant-form-item-label > label'), 'entity editor labels should have an explicit readable color');
assert(globalCss.includes('.entity-editor-modal .ant-input'), 'entity editor input fields should have an explicit readable color');
assert(globalCss.includes('.user-theme-active .ant-modal-content'), 'user modal portals should receive the active user theme');
assert(globalCss.includes("[data-theme='light'] .entity-editor-modal .ant-input"), 'light entity editor inputs should use a visibly distinct surface');

assert(globalCss.includes('.cm-loader'), 'global CSS should style the CM loader');
assert(/\.cm-loader-dash\s*\{[^}]*cm-loader-dash-array/.test(globalCss), 'global CSS should use CM-prefixed loader keyframes');
assert(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.cm-loader-dash[\s\S]*?animation:\s*none/.test(globalCss), 'CM loader should respect reduced motion');
assert(/try\s*\{\s*await saveHistory\([\s\S]*?\);\s*\}\s*catch\s*\(error\)\s*\{\s*message\.warning\('生成成功，但保存历史失败'\);\s*\}\s*setOutput\(nextOutput\)/.test(scriptPage), 'script page should preserve generated output when history saving fails');
assert(/catch\s*\(error\)\s*\{\s*setOutput\(''\);[\s\S]{0,200}?message\.error/.test(scriptPage), 'script page should clear output when generation fails');

const homePage = read('frontend/src/user/pages/HomePage.jsx');
const splashCursor = read('frontend/src/user/components/HomeSplashCursor.jsx');
assert(homePage.includes('<BrandLogo className="home-brand-logo" />'), 'home hero should render the supplied brand logo');
assert(homePage.includes('home-video-hero'), 'React home page should use a fullscreen video hero');
assert(homePage.includes('<video'), 'React home page should render a video background');
assert(homePage.includes('home-hero-nav'), 'React home page should include a hero navigation bar');
assert(homePage.includes('contact-button'), 'React home page should include a contact button');
assert(homePage.includes('quick-action-card'), 'React home page should restore old quick action cards');
assert(homePage.includes('home-recent-section'), 'React home page should restore old recent projects section');
assert(homePage.includes('<HomeSplashCursor />'), 'home hero should render the scoped fluid cursor layer');
assert(splashCursor.includes("className=\"home-splash-cursor\""), 'fluid cursor should expose a home-scoped canvas layer');
assert(splashCursor.includes("pointerEvents: 'none'"), 'fluid cursor must not intercept homepage interactions');
assert(splashCursor.includes("prefers-reduced-motion: reduce"), 'fluid cursor should respect reduced motion preferences');
assert(splashCursor.includes('webgl') && splashCursor.includes('return null'), 'fluid cursor should safely skip unsupported WebGL environments');
assert(globalCss.includes('.home-splash-cursor'), 'global CSS should constrain the fluid cursor to the homepage hero');

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
