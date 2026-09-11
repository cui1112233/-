import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryV11Workbench.jsx'), 'utf8');

test('Director UI consumes server book state without calculating effective settings in React', () => {
  assert.equal(source.includes('const directorBook = useMemo'), false);
  assert.equal(source.includes('selectedBook.mode || batch?.mode'), false);
  assert.equal(source.includes('selectedBook.fixedSingleVideo ?? batch?.fixedSingleVideo'), false);
  assert.equal(source.includes('selectedBook.modelCapability || batch?.modelCapability'), false);
  assert.match(source, /<DirectorPanel[\s\S]*book=\{selectedBook\}/);
  assert.match(source, /<HookReviewPanel[\s\S]*book=\{selectedBook\}/);
});
