import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'UserLayout.jsx'), 'utf8');

test('global header status expires instead of permanently retaining API polling failures', () => {
  assert.match(source, /expiresAt/);
  assert.match(source, /window\.setTimeout\(\(\) =>/);
  assert.match(source, /setGlobalStatus\(current => current\.expiresAt === expiresAt \? \{ text: '', tone: 'idle'/);
});

test('avatar opens the account-center menu without competing with a profile redirect', () => {
  const avatarButton = source.slice(
    source.indexOf('className="legacy-sidebar-avatar"'),
    source.indexOf('</button>', source.indexOf('className="legacy-sidebar-avatar"'))
  );

  assert.match(avatarButton, /setAccountCenterOpen\(true\)/);
  assert.doesNotMatch(avatarButton, /window\.location\.assign\('\/profile'\)/);
  assert.match(source, /<Link href="\/profile" className=\{pathname === '\/profile'/);
});
