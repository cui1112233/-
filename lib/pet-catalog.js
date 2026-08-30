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
  spriteVersionNumber: 2,
  spritesheetPath: '/pets/pixiu/spritesheet.webp',
  atlasProfile: 'stacky-v2',
  animationProfile: 'pixiu-v1',
  behaviorProfile: 'cm-v1',
  speechProfile: 'cm-v1',
  renderMode: 'smooth'
});

const PET_DEFINITIONS = Object.freeze([stackyPet, pixiuPet]);
const DEFAULT_PET_ID = 'stacky';

function findPetDefinition(value) {
  const id = typeof value === 'string' ? value : value?.id;
  return PET_DEFINITIONS.find(pet => pet.id === id) || null;
}

function normalizePetConfig(value, fallback) {
  return findPetDefinition(value) || findPetDefinition(fallback) || findPetDefinition(DEFAULT_PET_ID);
}

module.exports = { DEFAULT_PET_ID, PET_DEFINITIONS, findPetDefinition, normalizePetConfig };
