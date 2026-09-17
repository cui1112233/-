function normalizePrompt(value) {
  return String(value || '').trim();
}

export function isShotVideoTaskCurrent(task, prompt) {
  const savedPrompt = normalizePrompt(task?.prompt);
  return Boolean(savedPrompt) && savedPrompt === normalizePrompt(prompt);
}
