export async function runSaveFlow({ payload, onSave, onClose }) {
  const result = await onSave?.(payload);
  if (result !== false) onClose?.();
  return result;
}
