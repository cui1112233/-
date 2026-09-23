import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { buildInlineMentionSegments, canonicalTextFromSegments } from '../pages/scriptInlineMentions';

function selectionOffset(root) {
  const selection = window.getSelection();
  if (!root || !selection?.rangeCount || !root.contains(selection.anchorNode)) return 0;
  const range = selection.getRangeAt(0);
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

function selectionRect() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return rect.width || rect.height ? rect : null;
}

function setSelectionOffset(root, wantedOffset) {
  if (!root || typeof document === 'undefined') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let remaining = Math.max(0, wantedOffset);
  while (node) {
    const size = node.textContent.length;
    if (remaining <= size) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= size;
    node = walker.nextNode();
  }
}

function mentionBoundary(segments, cursor, direction) {
  let position = 0;
  for (const segment of segments) {
    const size = segment.type === 'mention' ? segment.name.length + 1 : segment.value.length;
    const start = position;
    const end = position + size;
    if (segment.type === 'mention' && ((direction === 'backspace' && cursor === end) || (direction === 'delete' && cursor === start))) {
      return { start, end };
    }
    position = end;
  }
  return null;
}

export default function ScriptMentionEditor({
  value,
  candidates,
  editable,
  placeholder,
  onChange,
  onQueryChange
}) {
  const editorRef = useRef(null);
  const composingRef = useRef(false);
  const restoreOffsetRef = useRef(null);
  const segments = useMemo(() => buildInlineMentionSegments(value, candidates), [value, candidates]);

  useLayoutEffect(() => {
    if (restoreOffsetRef.current === null) return;
    setSelectionOffset(editorRef.current, restoreOffsetRef.current);
    restoreOffsetRef.current = null;
  }, [value, segments]);

  const emitQuery = useCallback((text = canonicalTextFromSegments(segments)) => {
    const root = editorRef.current;
    onQueryChange?.({ text, cursor: selectionOffset(root), rect: selectionRect() });
  }, [onQueryChange, segments]);

  const emitTextChange = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const text = root.innerText.replace(/\r/g, '');
    restoreOffsetRef.current = selectionOffset(root);
    onChange?.(text);
    emitQuery(text);
  }, [emitQuery, onChange]);

  const handlePaste = useCallback(event => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text/plain');
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(pasted);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    emitTextChange();
  }, [emitTextChange]);

  const handleKeyDown = useCallback(event => {
    if (!editable || !['Backspace', 'Delete'].includes(event.key)) return;
    const cursor = selectionOffset(editorRef.current);
    const boundary = mentionBoundary(segments, cursor, event.key === 'Backspace' ? 'backspace' : 'delete');
    if (!boundary) return;
    event.preventDefault();
    const text = canonicalTextFromSegments(segments);
    restoreOffsetRef.current = boundary.start;
    onChange?.(`${text.slice(0, boundary.start)}${text.slice(boundary.end)}`);
  }, [editable, onChange, segments]);

  return <div
    ref={editorRef}
    className="script-mention-editor"
    contentEditable={editable}
    suppressContentEditableWarning
    role="textbox"
    aria-multiline="true"
    aria-label={placeholder || '剧本编辑器'}
    data-placeholder={placeholder || ''}
    onInput={() => { if (!composingRef.current) emitTextChange(); }}
    onKeyDown={handleKeyDown}
    onKeyUp={() => { if (!composingRef.current) emitQuery(); }}
    onClick={() => emitQuery()}
    onPaste={handlePaste}
    onCompositionStart={() => { composingRef.current = true; }}
    onCompositionEnd={() => { composingRef.current = false; emitTextChange(); }}
  >
    {segments.map((segment, index) => segment.type === 'mention' ? <span
      key={`${segment.value}-${index}`}
      className="script-mention-chip"
      contentEditable={false}
      data-mention-name={segment.name}
      data-mention-value={segment.value}
    >
      {segment.imageUrl ? <img src={segment.imageUrl} alt="" loading="lazy" /> : <span className="script-mention-chip-placeholder" aria-hidden="true">{segment.kind === 'scene' ? '景' : '人'}</span>}
      <span>@{segment.name}</span>
    </span> : <span key={`text-${index}`}>{segment.value}</span>)}
  </div>;
}
