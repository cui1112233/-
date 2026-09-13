export function contentRangeLinesForBook(book) {
  const value = Number(book?.sourceMetadata?.contentRangeLines);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 500) : 5;
}

export function contentCaptureCharactersForBook(book) {
  const value = Number(book?.sourceMetadata?.contentCaptureCharacters);
  return Number.isInteger(value) && value >= 100 && value <= 100000 ? value : 4000;
}

export function batchFactoryPreviewText(sourceText, book) {
  return String(sourceText || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, contentRangeLinesForBook(book))
    .join('\n');
}
