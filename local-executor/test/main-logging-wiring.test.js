const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test('Electron main wires one userData JSONL logger into adapter and JobRunner', async () => {
  const source = await readFile(path.join(__dirname, '..', 'src', 'electron', 'main.js'), 'utf8');
  assert.match(source, /createJsonlLogger/);
  assert.match(source, /path\.join\(userData,\s*'logs',\s*'executor-events\.jsonl'\)/);
  assert.match(source, /new DoubaoAdapter\(\{[\s\S]*logger/);
  assert.match(source, /runnerOptions:\s*\{\s*logger\s*\}/);
});
