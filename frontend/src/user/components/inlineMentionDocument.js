function textValue(value) {
  return String(value || '');
}

function imageBackedAssets(assets) {
  return new Map((Array.isArray(assets) ? assets : [])
    .filter(asset => asset?.hasImage && asset?.mainImageUrl && asset?.name)
    .map(asset => [String(asset.name), asset]));
}

export function buildInlineMentionNodes(text, assets = []) {
  const source = textValue(text);
  const byName = imageBackedAssets(assets);
  if (!source || !byName.size) return [{ kind: 'text', text: source }];

  const nodes = [];
  const mentionPattern = /@([\p{L}\p{N}_-]+)/gu;
  let cursor = 0;
  let match;
  while ((match = mentionPattern.exec(source))) {
    const asset = byName.get(match[1]);
    if (!asset) continue;
    if (match.index > cursor) nodes.push({ kind: 'text', text: source.slice(cursor, match.index) });
    nodes.push({ kind: 'mention', text: match[0], name: match[1], imageUrl: asset.mainImageUrl });
    cursor = mentionPattern.lastIndex;
  }
  if (cursor < source.length || !nodes.length) nodes.push({ kind: 'text', text: source.slice(cursor) });
  return nodes;
}

export function replaceMentionToken(text, target, asset) {
  const source = textValue(text);
  const name = textValue(asset?.name).trim();
  const start = Number.isInteger(target?.start) ? target.start : source.length;
  const end = Number.isInteger(target?.end) ? target.end : start;
  if (!name || start < 0 || end < start || end > source.length) return { text: source, caret: start };
  const token = `@${name} `;
  return { text: `${source.slice(0, start)}${token}${source.slice(end)}`, caret: start + token.length };
}

function serializeNode(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  const element = /** @type {HTMLElement} */ (node);
  const mentionName = String(element.dataset?.mentionName || '').trim();
  if (mentionName) return `@${mentionName}`;
  if (element.tagName === 'BR') return '\n';
  return Array.from(element.childNodes || []).map(serializeNode).join('');
}

export function serializeInlineMentionRoot(root) {
  return Array.from(root?.childNodes || []).map(serializeNode).join('');
}
