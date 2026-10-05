function downloadTitle(value) {
  const title = String(value || '').trim().replace(/[\\/:*?"<>|]/g, '_');
  return title || '小说';
}

export function downloadProductionContent({ title, content, documentRef = document, urlApi = URL }) {
  const text = String(content || '').trim();
  if (!text) return false;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = urlApi.createObjectURL(blob);
  const link = documentRef.createElement('a');
  link.href = url;
  link.download = `${downloadTitle(title)}-生产正文.txt`;
  documentRef.body?.appendChild?.(link);
  link.click();
  link.remove?.();
  urlApi.revokeObjectURL(url);
  return true;
}
