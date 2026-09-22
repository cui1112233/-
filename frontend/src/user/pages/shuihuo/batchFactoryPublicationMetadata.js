export function publicationMetadataValue(metadata = {}, key) {
  const current = String(metadata?.[key] || '').trim();
  return current || '待 AI 判断';
}
