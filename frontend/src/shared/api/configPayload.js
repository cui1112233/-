export function normalizeConfigPayload(config = {}) {
  const payload = { ...config };
  const rawPet = payload.pet;
  const petId = typeof rawPet === 'string' ? rawPet : rawPet?.id;

  if (typeof petId === 'string' && petId.trim()) {
    payload.pet = petId.trim();
  } else {
    delete payload.pet;
  }

  return payload;
}
