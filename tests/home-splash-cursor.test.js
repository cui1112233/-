const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('homepage fluid cursor is scoped, non-blocking, and has safe fallbacks', () => {
  const homePage = read('frontend/src/user/pages/HomePage.jsx');
  const cursor = read('frontend/src/user/components/HomeSplashCursor.jsx');
  const css = read('frontend/src/shared/styles/global.css');

  assert(homePage.includes("import HomeSplashCursor from '../components/HomeSplashCursor';"));
  assert(homePage.includes('<HomeSplashCursor />'));
  assert(cursor.includes('className="home-splash-cursor"'));
  assert(cursor.includes("pointerEvents: 'none'"));
  assert(cursor.includes("prefers-reduced-motion: reduce"));
  assert(cursor.includes("matchMedia('(pointer: coarse)')"));
  assert(cursor.includes('if (!gl) return null;'));
  assert(cursor.includes("WEBGL_lose_context") && cursor.includes('loseContext'));
  assert(css.includes('.home-splash-cursor') && css.includes('mix-blend-mode: screen'));
});
