import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'PresetLibraryPage.jsx'), 'utf8');

test('saving a script constraint from the batch factory library preserves its script module', () => {
  const saveDraft = source.match(/async function saveDraft\(values\) \{[\s\S]*?\n  }\n\n  async function publish/)?.[0] || '';

  assert.match(saveDraft, /const targetModule = editingPreset\?\.module \|\| module;/);
  assert.match(saveDraft, /module: targetModule,/);
});

test('batch factory library can label the script constraint slots it also displays', () => {
  assert.match(source, /listAdminPresetSlots\('script'\)/);
  assert.match(source, /setSlots\(\[\.\.\.\(slotResult\.slots \|\| \[\]\), \.\.\.\(extraSlotResult\?\.slots \|\| \[\]\)\]\)/);
});
