import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { buildInlineMentionNodes, replaceMentionToken, serializeInlineMentionRoot } from './inlineMentionDocument';
import { findMentionToken } from './mentionAssetMenu';

function selectedTextBefore(root) {
  const selection = window.getSelection?.();
  if (!root || !selection?.rangeCount) return '';
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return '';
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  return serializeInlineMentionRoot(before.cloneContents());
}

function anchorRect(root) {
  const selection = window.getSelection?.();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rect = [...range.getClientRects()].at(-1) || range.getBoundingClientRect();
  const fallback = root?.getBoundingClientRect?.();
  const left = rect?.left || fallback?.left;
  const top = rect?.top || fallback?.top;
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  const height = rect?.height || 20;
  return { left, top, right: left, bottom: top + height, width: 0, height };
}

function setCaretAtCanonicalOffset(root, offset) {
  if (!root || typeof document === 'undefined') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let consumed = 0;
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE && current.dataset?.mentionName) {
      const length = `@${current.dataset.mentionName}`.length;
      if (offset <= consumed + length) {
        const range = document.createRange();
        range.setStartBefore(current);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      consumed += length;
      current = walker.nextNode();
      continue;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      const text = current.nodeValue || '';
      if (offset <= consumed + text.length) {
        const range = document.createRange();
        range.setStart(current, Math.max(0, offset - consumed));
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      consumed += text.length;
    }
    current = walker.nextNode();
  }
  root.focus();
}

export const InlineMentionEditor = forwardRef(function InlineMentionEditor({ value, assets, onChange, onMentionTarget, ariaLabel, className = '' }, ref) {
  const rootRef = useRef(null);
  const draftRef = useRef(value);
  const committedValueRef = useRef(value);
  const [failedImages, setFailedImages] = useState(() => new Set());
  const [renderValue, setRenderValue] = useState(value);
  const usableAssets = useMemo(() => (Array.isArray(assets) ? assets : []).map(asset => (
    failedImages.has(asset.mainImageUrl) ? { ...asset, hasImage: false, mainImageUrl: '' } : asset
  )), [assets, failedImages]);
  const nodes = useMemo(() => buildInlineMentionNodes(renderValue, usableAssets), [renderValue, usableAssets]);

  function syncMentionTarget() {
    const before = selectedTextBefore(rootRef.current);
    const token = findMentionToken(before, before.length);
    onMentionTarget?.(token ? { ...token, filterQuery: token.query.toLowerCase(), anchorRect: anchorRect(rootRef.current) } : null);
  }

  function handleInput() {
    draftRef.current = serializeInlineMentionRoot(rootRef.current);
    requestAnimationFrame(syncMentionTarget);
  }

  function commitDraft() {
    const nextValue = draftRef.current;
    if (nextValue === committedValueRef.current) return;
    committedValueRef.current = nextValue;
    setRenderValue(nextValue);
    onChange?.(nextValue);
  }

  useImperativeHandle(ref, () => ({
    replaceTarget(target, asset) {
      const next = replaceMentionToken(draftRef.current, target, asset);
      draftRef.current = next.text;
      committedValueRef.current = next.text;
      setRenderValue(next.text);
      onChange?.(next.text);
      requestAnimationFrame(() => {
        setCaretAtCanonicalOffset(rootRef.current, next.caret);
        syncMentionTarget();
      });
    },
    focus() {
      rootRef.current?.focus();
    }
  }), [onChange]);

  useEffect(() => {
    if (value === committedValueRef.current) return;
    draftRef.current = value;
    committedValueRef.current = value;
    setRenderValue(value);
  }, [value]);

  useEffect(() => {
    setFailedImages(current => {
      const valid = new Set((assets || []).map(asset => asset.mainImageUrl).filter(Boolean));
      const next = new Set([...current].filter(url => valid.has(url)));
      return next.size === current.size ? current : next;
    });
  }, [assets]);

  return <div
    ref={rootRef}
    className={`inline-mention-editor ${className}`.trim()}
    contentEditable
    suppressContentEditableWarning
    role="textbox"
    aria-label={ariaLabel}
    aria-multiline="true"
    onInput={handleInput}
    onKeyUp={syncMentionTarget}
    onClick={syncMentionTarget}
    onFocus={syncMentionTarget}
    onBlur={commitDraft}
  >
    {nodes.map((node, index) => node.kind === 'mention' ? <span
      className="inline-image-mention"
      contentEditable={false}
      data-mention-name={node.name}
      key={`${node.name}-${index}`}
    ><img src={node.imageUrl} alt="" onError={() => setFailedImages(current => new Set([...current, node.imageUrl]))} />{node.name}</span> : node.text)}
  </div>;
});
