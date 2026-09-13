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


export function publishContentWithWorkingFront(sourceText, workingFrontContent, book) {
  const sourceLines = String(sourceText || '').split(/\r?\n/);
  const editedLines = String(workingFrontContent || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!editedLines.length) return String(sourceText || '');
  const limit = contentRangeLinesForBook(book);
  let replacement = 0;
  let seen = 0;
  return sourceLines.map(line => {
    if (!line.trim() || seen >= limit) return line;
    seen += 1;
    if (replacement >= editedLines.length) return line;
    const next = editedLines[replacement];
    replacement += 1;
    return next;
  }).join('\n');
}
