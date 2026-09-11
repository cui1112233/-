const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptPagePath = path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'ScriptPage.jsx');

test('H3 shot submission resolves the card duration before entering the generating state', () => {
  const source = fs.readFileSync(scriptPagePath, 'utf8').replace(/\r\n?/g, '\n');
  const resolverImport = "import { resolveShotVideoDuration } from './scriptVideoDuration';";
  const resolverCall = '? resolveShotVideoDuration({ shotText: prompt, fallbackDuration })';
  const invalidResultGuard = "if (!resolvedDuration.ok) {\n      message.error(resolvedDuration.error);\n      return;\n    }";

  assert.ok(source.includes(resolverImport), 'ScriptPage imports the H3 duration resolver');
  assert.ok(source.includes(resolverCall), 'H3 submission resolves the current card duration');
  assert.ok(source.includes(invalidResultGuard), 'invalid H3 card durations stop before submission');
  assert.ok(source.includes('duration: resolvedDuration.duration,'), 'H3 payload receives the resolved duration');
  assert.ok(source.indexOf(resolverCall) < source.indexOf('setGeneratingShotIndexes(current => new Set([...current, index]));'), 'duration resolution happens before generating state is set');
});
