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

export const PET_DEFINITIONS = Object.freeze([stackyPet]);
export const DEFAULT_PET_ID = 'stacky';

export function getPetDefinition(value) {
  const id = typeof value === 'string' ? value : value?.id;
  return PET_DEFINITIONS.find(pet => pet.id === id) || stackyPet;
}
