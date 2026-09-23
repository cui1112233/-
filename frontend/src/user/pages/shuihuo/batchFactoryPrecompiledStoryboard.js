function h3DirectorCards(book = {}) {
  const output = book?.directorRevision?.output || {};
  const document = output.h3_director || output.h3Director || {};
  return Array.isArray(document.director_cards) ? document.director_cards : Array.isArray(document.directorCards) ? document.directorCards : [];
}

// H3 produces book-level assets before it compiles final VIDEO segments.
// During that interval there is no per-video binding yet, but the saved
// assets are still real, useful output and must remain visible in the row.
export function resolvePrecompiledStoryboardAssets(book = {}) {
  if ((book?.videos || []).length > 0 || h3DirectorCards(book).length === 0) return [];
  return Array.isArray(book?.assetRecords) ? book.assetRecords : [];
}
