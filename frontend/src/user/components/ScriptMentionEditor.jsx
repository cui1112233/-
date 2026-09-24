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

function selectionRect(root) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const rect = [...range.getClientRects()].find(item => item.height) || range.getBoundingClientRect();
  if (rect.width || rect.height) return rect;
  return root?.getBoundingClientRect?.() || null;
}

function setSelectionOffset(root, wantedOffset) {
  if (!root || typeof document === 'undefined') return;
  let remaining = Math.max(0, wantedOffset);
  const children = [...root.childNodes];
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    const isMention = node.nodeType === Node.ELEMENT_NODE && node.dataset?.mentionValue;
    const size = isMention ? node.dataset.mentionValue.length : node.textContent.length;
    if (remaining <= size) {
      const range = document.createRange();
      if (isMention) {
        if (remaining === 0) range.setStartBefore(node);
        else range.setStartAfter(node);
      } else range.setStart(node.firstChild || node, Math.min(remaining, node.textContent.length));
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= size;
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

function renderSegments(root, segments) {
  const fragment = document.createDocumentFragment();
  for (const segment of segments) {
    if (segment.type !== 'mention') {
      fragment.append(document.createTextNode(segment.value));
      continue;
    }
    const chip = document.createElement('span');
    chip.className = 'script-mention-chip';
    chip.contentEditable = 'false';
    chip.dataset.mentionName = segment.name;
    chip.dataset.mentionValue = segment.value;
    if (segment.imageUrl) {
      const image = document.createElement('img');
      image.src = segment.imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      chip.append(image);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'script-mention-chip-placeholder';
      fallback.setAttribute('aria-hidden', 'true');
      fallback.textContent = segment.kind === 'scene' ? '景' : '人';
      chip.append(fallback);
    }
    const label = document.createElement('span');
    label.textContent = `@${segment.name}`;
    chip.append(label);
    fragment.append(chip);
  }
  root.replaceChildren(fragment);
}

export default function ScriptMentionEditor({
  value,
  candidates,
  editable,
  placeholder,
  selectionOffset: initialSelectionOffset,
  onChange,
  onQueryChange,
  onEditorKeyDown
}) {
  const editorRef = useRef(null);
  const composingRef = useRef(false);
  const restoreOffsetRef = useRef(null);
  const segments = useMemo(() => buildInlineMentionSegments(value, candidates), [value, candidates]);

  useLayoutEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    renderSegments(root, segments);
    if (Number.isInteger(initialSelectionOffset)) restoreOffsetRef.current = initialSelectionOffset;
    if (restoreOffsetRef.current === null) return;
    setSelectionOffset(root, restoreOffsetRef.current);
    restoreOffsetRef.current = null;
  }, [initialSelectionOffset, value, segments]);

  const emitQuery = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const text = root.innerText.replace(/\r/g, '');
    onQueryChange?.({ text, cursor: selectionOffset(root), rect: selectionRect(root) });
  }, [onQueryChange]);

  const emitTextChange = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const text = root.innerText.replace(/\r/g, '');
    // Changing the parent value can synchronously redraw this contenteditable
    // surface. Read the caret before that redraw so an @ just typed still
    // opens its candidate menu at the original location.
    const cursor = selectionOffset(root);
    const rect = selectionRect(root);
    restoreOffsetRef.current = cursor;
    onChange?.(text);
    onQueryChange?.({ text, cursor, rect });
  }, [onChange, onQueryChange]);

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
    onEditorKeyDown?.(event);
    if (event.defaultPrevented || !editable || !['Backspace', 'Delete'].includes(event.key)) return;
    const cursor = selectionOffset(editorRef.current);
    const boundary = mentionBoundary(segments, cursor, event.key === 'Backspace' ? 'backspace' : 'delete');
    if (!boundary) return;
    event.preventDefault();
    const text = canonicalTextFromSegments(segments);
    restoreOffsetRef.current = boundary.start;
    onChange?.(`${text.slice(0, boundary.start)}${text.slice(boundary.end)}`);
  }, [editable, onChange, onEditorKeyDown, segments]);

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
  />;
}
