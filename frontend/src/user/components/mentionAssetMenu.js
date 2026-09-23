function entityName(item) {
  const data = item?.data && typeof item.data === 'object' ? item.data : item || {};
  return String(data.角色名称 || data.场景名称 || data.名称 || data.name || data.场景 || data.scene || '').trim();
}

function entityMainImage(item) {
  const urls = Array.isArray(item?.imageUrls) ? item.imageUrls.filter(Boolean) : [];
  return String(item?.mainImageUrl || (urls.length === 1 ? urls[0] : '') || '').trim();
}

export function findMentionToken(value, caret) {
  const text = String(value || '');
  const end = Number.isInteger(caret) ? caret : text.length;
  const match = text.slice(0, end).match(/@([\u4e00-\u9fffA-Za-z0-9_-]*)$/);
  return match ? { start: end - match[0].length, end, query: match[1] } : null;
}

function readCaretRect(input, caret) {
  if (!input || typeof document === 'undefined' || typeof window === 'undefined') return null;
  const inputRect = input.getBoundingClientRect();
  const styles = window.getComputedStyle(input);
  const mirror = document.createElement('div');
  const marker = document.createElement('span');
  const copied = ['boxSizing', 'width', 'height', 'overflowX', 'overflowY', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontFamily', 'lineHeight', 'letterSpacing', 'textTransform', 'textIndent', 'textAlign', 'wordSpacing', 'tabSize'];
  copied.forEach(key => { mirror.style[key] = styles[key]; });
  Object.assign(mirror.style, { position: 'fixed', left: `${inputRect.left}px`, top: `${inputRect.top}px`, visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', pointerEvents: 'none' });
  mirror.textContent = String(input.value || '').slice(0, caret);
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const markerRect = marker.getBoundingClientRect();
  mirror.remove();
  const lineHeight = Number.parseFloat(styles.lineHeight) || Number.parseFloat(styles.fontSize) * 1.35 || 18;
  const top = markerRect.top - input.scrollTop;
  return { left: markerRect.left, top, right: markerRect.left, bottom: top + lineHeight, width: 0, height: lineHeight };
}

export function findMentionTarget(input, value) {
  const caret = Number.isInteger(input?.selectionStart) ? input.selectionStart : String(value || '').length;
  const token = findMentionToken(value, caret);
  return token ? { ...token, filterQuery: token.query.toLowerCase(), anchorRect: readCaretRect(input, caret) } : null;
}

export function buildMentionAssets(target, characters = [], scenes = []) {
  const query = String(target?.filterQuery ?? target?.query ?? '').toLowerCase();
  return [
    ...characters.map(item => ({ item, type: 'characters' })),
    ...scenes.map(item => ({ item, type: 'scenes' }))
  ].map(({ item, type }) => {
    const name = entityName(item);
    const mainImageUrl = entityMainImage(item);
    return { id: item.id, type, name, mainImageUrl, hasImage: Boolean(mainImageUrl) };
  }).filter(asset => asset.name && asset.name.toLowerCase().includes(query));
}
