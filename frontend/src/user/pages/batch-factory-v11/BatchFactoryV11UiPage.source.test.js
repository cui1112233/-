import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'BatchFactoryV11UiPage.jsx'), 'utf8');

test('lets the server resolve an authorized member team video provider', () => {
  assert.doesNotMatch(source, /provider === 'personal_api' && runtimeState\.videoProviders\?\.personalAPI\?\.configured === false/);
});
