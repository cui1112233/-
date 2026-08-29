const stackyPet = Object.freeze({
  id: 'stacky',
  displayName: 'CM',
  description: 'CM，前贴的桌面宠物。',
  spriteVersionNumber: 2,
  spritesheetPath: '/pets/stacky/spritesheet.webp',
  atlasProfile: 'stacky-v2',
  behaviorProfile: 'cm-v1',
  speechProfile: 'cm-v1',
  renderMode: 'pixelated'
});

const pixiuPet = Object.freeze({
  id: 'pixiu',
  displayName: '貔貅',
  description: '貔貅，前贴的招财守护宠物。',
  spriteVersionNumber: 1,
  spritesheetPath: '/pets/pixiu/spritesheet.svg',
  atlasProfile: 'stacky-v2',
  behaviorProfile: 'cm-v1',
  speechProfile: 'cm-v1',
  renderMode: 'smooth'
});

export const PET_DEFINITIONS = Object.freeze([stackyPet, pixiuPet]);
export const DEFAULT_PET_ID = 'stacky';
export const PET_SELECTION_EVENT = 'qiantie:pet-selection';

export function findPetDefinition(value) {
  const id = typeof value === 'string' ? value : value?.id;
  return PET_DEFINITIONS.find(pet => pet.id === id) || null;
}

export function getPetDefinition(value) {
  return findPetDefinition(value) || stackyPet;
}

export function getPetOptions() {
  return PET_DEFINITIONS.map(pet => ({ label: pet.displayName, value: pet.id }));
}

export function dispatchPetSelection(value) {
  if (typeof window === 'undefined') return;
  const pet = getPetDefinition(value);
  window.dispatchEvent(new CustomEvent(PET_SELECTION_EVENT, { detail: { pet } }));
}
