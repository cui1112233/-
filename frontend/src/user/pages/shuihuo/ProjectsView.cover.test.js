import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'ProjectsView.jsx'), 'utf8');

test('project-video covers seek a first frame instead of leaving a metadata-only blank card', () => {
  assert.match(source, /preload="auto"/);
  assert.match(source, /currentTime\s*=\s*0\.001/);
});
