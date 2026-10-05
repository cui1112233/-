export function contentRangeLinesForBook(book) {
  const value = Number(book?.sourceMetadata?.contentRangeLines);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 500) : 5;
}

export function contentCaptureCharactersForBook(book) {
  const value = Number(book?.sourceMetadata?.contentCaptureCharacters);
  return Number.isInteger(value) && value >= 100 && value <= 100000 ? value : 4000;
}

function normalizedSourceLine(value) {
  return String(value || '')
    .replace(/&nbsp;|\u00a0|　/g, ' ')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function isLeadingPageStateLine(value) {
  return /^(?:修改中|加载中|正文加载中|请稍候)$/.test(value);
}

function isPunctuationOnlyLine(value) {
  return /^[，。！？、；：…·—～~,.!?;:()（）【】\[\]{}「」『』“”"'\-]+$/.test(value);
}

function usableSourceLines(sourceText) {
  const lines = String(sourceText || '').split(/\r?\n/).map(normalizedSourceLine).filter(Boolean);
  let firstContent = 0;
  while (firstContent < lines.length && isLeadingPageStateLine(lines[firstContent])) firstContent += 1;
  return lines.slice(firstContent).filter(line => !isPunctuationOnlyLine(line));
}

// Detail dialogs, previews and production must use the same cleaned text.
// The raw upstream response is retained separately in source metadata.
export function batchFactoryCleanSourceText(sourceText) {
  return usableSourceLines(sourceText).join('\n');
}

export function batchFactoryPreviewText(sourceText, book) {
  return usableSourceLines(sourceText)
    .slice(0, contentRangeLinesForBook(book))
    .join('\n');
}

export function batchFactoryProductionText(sourceText, workingFrontContent, book) {
  const working = String(workingFrontContent || '').trim();
  return working || batchFactoryPreviewText(sourceText, book);
}

// A user-approved viral rewrite becomes the book's new complete source. The
// workbench still decides what to show from the saved source through
// batchFactoryPreviewText and the book's selected contentRangeLines.
export function sourceTextAfterViralAdoption(viralCandidate) {
  return String(viralCandidate || '').trim();
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
