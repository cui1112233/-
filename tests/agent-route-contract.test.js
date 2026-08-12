const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Agent uses the unified React shell lazy route instead of the legacy HTML page', () => {
  const pagesRoute = read('routes/pages.js');
  const userApp = read('frontend/src/user/App.jsx');
  const userLayout = read('frontend/src/shared/layouts/UserLayout.jsx');
  const agentPage = read('frontend/src/user/pages/AgentPage.jsx');

  assert.match(pagesRoute, /router\.get\('\/agent', serveReactEntry\('index\.html'/);
  assert.match(userApp, /const AgentPage = lazy\([\s\S]*?\.\/pages\/AgentPage/);
  assert.match(userApp, /const SettingsPage = lazy\([\s\S]*?\.\/pages\/SettingsPage/);
  assert.match(userApp, /const HistoryPage = lazy\([\s\S]*?\.\/pages\/HistoryPage/);
  assert.match(userApp, /const routes = \{[\s\S]*?'\/agent': AgentPage/);
  assert.match(userApp, /const routes = \{[\s\S]*?'\/settings': SettingsPage/);
  assert.match(userApp, /const routes = \{[\s\S]*?'\/history': HistoryPage/);
  assert.match(userApp, /const Page = routes\[pathname\];[\s\S]*?<Suspense[\s\S]*?<Page \/>/);
  assert.match(userLayout, /<Link key=\{item\.href\} href=\{item\.href\}/);
  assert.doesNotMatch(userLayout, /item\.href === '\/agent'/);
  assert.match(agentPage, /Agent 工作区/);
  assert.match(agentPage, /utility-workbench/);
});
