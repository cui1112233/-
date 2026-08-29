import assert from 'node:assert/strict';
import test from 'node:test';

async function loadPetCatalog() {
  try {
    return await import('./petCatalog.js');
  } catch {
    return null;
  }
}

test('desktop pets are defined through a reusable catalog module', async () => {
  const catalog = await loadPetCatalog();
  assert.ok(catalog, 'petCatalog.js should exist');
  assert.equal(typeof catalog.getPetDefinition, 'function');
  assert.ok(Array.isArray(catalog.PET_DEFINITIONS));
});
