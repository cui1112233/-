export function replaceRawShotCard(output, rawShotCards, cardIndex, nextCard) {
  const currentCard = Array.isArray(rawShotCards) ? rawShotCards[cardIndex] : '';
  const source = String(output || '');
  if (!currentCard) return source;
  const start = source.indexOf(currentCard);
  if (start < 0) return source;
  return `${source.slice(0, start)}${String(nextCard || '')}${source.slice(start + currentCard.length)}`;
}
