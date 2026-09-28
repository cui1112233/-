function h3DirectorCards(book = {}) {
  const output = book?.directorRevision?.output || {};
  const document = output.h3_director || output.h3Director || {};
  return Array.isArray(document.director_cards) ? document.director_cards : Array.isArray(document.directorCards) ? document.directorCards : [];
}

function h3FrameKey(card = {}, index = 0) {
  const stableKey = String(card?.source_key || card?.sourceKey || card?.id || '').trim();
  return stableKey ? `h3:${stableKey}` : `h3:index:${index}`;
}

// H3 produces book-level assets before it compiles final VIDEO segments.
// During that interval there is no per-video binding yet, but the saved
// assets are still real, useful output and must remain visible in the row.
export function resolvePrecompiledStoryboardAssets(book = {}) {
  if ((book?.videos || []).length > 0 || h3DirectorCards(book).length === 0) return [];
  return Array.isArray(book?.assetRecords) ? book.assetRecords : [];
}

export function resolvePrecompiledVideoWorkspace(book = {}) {
  const cards = h3DirectorCards(book);
  if ((book?.videos || []).length > 0 || cards.length === 0) return { status: 'unavailable', cards: [] };
  return {
    status: 'awaiting_compilation',
    cards,
    frames: cards.map((card, index) => ({ key: h3FrameKey(card, index), index, card }))
  };
}

// H3 has director cards before VIDEO entities exist.  The source key is the
// stable identity shared by the prompt, asset and video cells during that gap.
export function resolvePrecompiledStoryboardFrame(book = {}, selectedKey = '') {
  const workspace = resolvePrecompiledVideoWorkspace(book);
  if (workspace.status !== 'awaiting_compilation') return null;
  return workspace.frames.find(frame => frame.key === String(selectedKey || '')) || workspace.frames[0] || null;
}
