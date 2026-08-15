function cardRanges(output, cards) {
  let cursor = 0;
  return cards.map(card => {
    const formats = [card];
    try {
      const compact = JSON.stringify(JSON.parse(card));
      if (compact !== card) formats.push(compact);
    } catch {}
    const range = formats.reduce((found, format) => {
      const start = output.indexOf(format, cursor);
      return start >= 0 && (!found || start < found.start) ? { start, end: start + format.length } : found;
    }, null);
    if (!range) return null;
    cursor = range.end;
    return range;
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
