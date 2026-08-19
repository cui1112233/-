const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('unauthenticated homepage provides a docked login card that opens the existing form', () => {
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');
  const styles = read('frontend/src/shared/styles/global.css');

  assert.match(layout, /const showLoginCard = !isLoggedIn && \(isHome \|\| loginDialogOpen \|\| loginCardTransitioning\)/);
  assert.match(layout, /is-card-docked/);
  assert.match(layout, /<Lanyard/);
  assert.match(layout, /onCardClick=\{openLoginDialog\}/);
  assert.match(layout, /position=\{\[0, 0, 22\]\}/);
  assert.match(layout, /setLoginCardTransitioning\(true\)/);
  assert.match(styles, /\.login-lanyard-card/);
  assert.match(styles, /rotateZ\(180deg\)/);
  assert.match(styles, /\.login-modal \{[\s\S]*top: 50%/);
});
