const MOJIBAKE_MARKERS = /(?:Ã|Â|â|ã|ä|å|æ|ç|è|é|ê|ë|ï|ð|Ñ|�)/g;
const CP1252_TO_BYTE = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x2c6, 0x88], [0x2030, 0x89], [0x160, 0x8a],
  [0x2039, 0x8b], [0x152, 0x8c], [0x17d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x2dc, 0x98], [0x2122, 0x99], [0x161, 0x9a], [0x203a, 0x9b], [0x153, 0x9c],
  [0x17e, 0x9e], [0x178, 0x9f]
]);

function mojibakeScore(value) {
  return (String(value).match(MOJIBAKE_MARKERS) || []).length;
}

function repairMojibakeText(value) {
  const source = String(value ?? '');
  if (!source || mojibakeScore(source) < 1) return source;
  let current = source;
  for (let pass = 0; pass < 3; pass += 1) {
    const beforeScore = mojibakeScore(current);
    if (!beforeScore) break;
    try {
      const bytes = [];
      for (const character of current) {
        const codePoint = character.codePointAt(0);
        bytes.push(CP1252_TO_BYTE.get(codePoint) ?? (codePoint <= 0xff ? codePoint : 0x3f));
      }
      const candidate = Buffer.from(bytes).toString('utf8');
      const replacementBefore = (current.match(/\ufffd/g) || []).length;
      const replacementAfter = (candidate.match(/\ufffd/g) || []).length;
      if (!candidate || replacementAfter > replacementBefore || mojibakeScore(candidate) >= beforeScore) break;
      current = candidate;
    } catch (_) {
      break;
    }
  }
  return current;
}

function repairMojibakeDeep(value) {
  if (typeof value === 'string') return repairMojibakeText(value);
  if (Array.isArray(value)) return value.map(repairMojibakeDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, repairMojibakeDeep(item)]));
  }
  return value;
}

module.exports = { repairMojibakeText, repairMojibakeDeep };
