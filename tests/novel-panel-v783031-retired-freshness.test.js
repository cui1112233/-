const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const workbench = path.join(root, 'public/novel-panel/workbench');
const runtimePath = path.join(workbench, 'v783031-runtime.js');
const indexPath = path.join(workbench, 'index.html');
const backendRoutePath = path.join(root, 'routes/novel-panel.js');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function walkFiles(dir, seen = new Set()) {
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch (_) {
    return [];
  }
  if (seen.has(real)) return [];
  seen.add(real);

  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...walkFiles(full, seen));
      continue;
    }
    if (/\.(?:js|html|css)$/i.test(entry.name)) files.push(full);
  }
  return files;
}

const allWorkbenchText = walkFiles(workbench).map(read).join('\n');
const runtime = read(runtimePath);
const index = read(indexPath);
const backendRoute = read(backendRoutePath);

// V78.3.0.24 final state: the artifact-dependency freshness runtime was retired.
for (const token of [
  'outlineArtifactDependencyStatusV783024',
  'bindOutlineArtifactDependenciesV783024',
  'assertOutlineArtifactDependenciesFreshV783024',
  'outlineArtifactGlobalDependencyFingerprintV783024',
]) {
  assert.equal(allWorkbenchText.includes(token), false, `${token} must stay retired`);
}

// V78.3.0.25 final state: no stale-artifact recovery queue/buttons may return.
for (const token of [
  'regenerateStaleOutlineArtifactsV783025',
  'staleArtifactRecoveryQueue',
  'staleArtifactAutoMerge',
  'staleArtifactPartialCommit',
  'repairStaleOutlineBtn',
  'adoptSemanticBaselineBtn',
]) {
  assert.equal(allWorkbenchText.includes(token), false, `${token} must stay retired`);
}

// V78.3.0.26 final state: semantic-baseline/freshness migration is also retired.
for (const token of [
  'outlineArtifactSemanticCharacterV783026',
  'outlineArtifactSemanticGlobalV783026',
  'adoptCurrentOutlineArtifactSemanticBaselineV783026',
  'mergeSemanticBeforeV783026',
  'mergeSemanticAfterV783026',
  'MERGE_SEMANTIC_SIDE_EFFECT',
  'R8.9_MERGE_ADVISORY',
]) {
  assert.equal(allWorkbenchText.includes(token), false, `${token} must stay retired`);
}

// Final authority is source transaction + generation input revision/fingerprint + current truth.
assert.match(runtime, /finalOutputReadsCurrentStateDirectly:true/);
assert.match(runtime, /singleGenerationRevisionAuthority:true/);
assert.match(runtime, /staleArtifactRecoveryRemoved:true/);
assert.match(runtime, /__currentSourceTransactionV783022/);
assert.match(runtime, /__outlineGenerationInputTransactionV783023/);
assert.match(runtime, /__captureGenerationCurrentTruthV783028/);

// Guard against reintroducing the retired recovery UI under the public workbench shell.
assert.doesNotMatch(index, /repairStaleOutlineBtn|adoptSemanticBaselineBtn/);

// Workspace schema remains the existing v88 schema; V31 is a semantic migration, not a schema migration.
assert.match(backendRoute, /workspace_schema_version:\s*40\b/);

console.log('V78.3.0.24-26 retired freshness semantics regression: PASS');
