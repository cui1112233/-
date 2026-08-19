export function splitShotTextHighlight(card, displayRange) {
  if (!displayRange) return null;
  const { start, end } = displayRange;
  if (start < 0 || end <= start || end > card.length) return null;
  return {
    before: card.slice(0, start),
    highlight: card.slice(start, end),
    after: card.slice(end)
  };
}
