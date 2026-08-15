function cardRanges(output, cards) {
  let cursor = 0;
  return cards.map(card => {
    const start = output.indexOf(card, cursor);
    if (start < 0) return null;
    cursor = start + card.length;
    return { start, end: cursor };
  });
}

export function getSelectedShotMatches(output, cards, selectedIndexes, findText) {
  if (!findText || !selectedIndexes?.size) return [];
  return cardRanges(output, cards).flatMap((range, cardIndex) => {
    if (!range || !selectedIndexes.has(cardIndex)) return [];
    const card = output.slice(range.start, range.end);
    const matches = [];
    let offset = 0;
    while (offset <= card.length - findText.length) {
      const index = card.indexOf(findText, offset);
      if (index < 0) break;
      matches.push({ cardIndex, start: range.start + index, end: range.start + index + findText.length });
      offset = index + findText.length;
    }
    return matches;
  });
}

export function replaceSelectedShotMatch(output, match, replaceText) {
  return `${output.slice(0, match.start)}${replaceText}${output.slice(match.end)}`;
}

export function replaceAllSelectedShotMatches(output, matches, replaceText) {
  return [...matches].sort((left, right) => right.start - left.start).reduce(
    (next, match) => replaceSelectedShotMatch(next, match, replaceText),
    output
  );
}
