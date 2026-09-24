import { buildInlineMentionSegments } from '../pages/scriptInlineMentions';

function highlightedText(value, start, highlightRange, key) {
  const text = String(value || '');
  if (!highlightRange || !text) return <span key={key}>{text}</span>;
  const end = start + text.length;
  const highlightStart = Math.max(start, highlightRange.start);
  const highlightEnd = Math.min(end, highlightRange.end);
  if (highlightStart >= highlightEnd) return <span key={key}>{text}</span>;
  const from = highlightStart - start;
  const to = highlightEnd - start;
  return <span key={key}>{text.slice(0, from)}<mark className="shot-output-card-match">{text.slice(from, to)}</mark>{text.slice(to)}</span>;
}

export default function ScriptMentionDisplay({ text, candidates, highlightRange }) {
  const segments = buildInlineMentionSegments(text, candidates);
  let offset = 0;

  return <>{segments.map((segment, index) => {
    const start = offset;
    offset += segment.value.length;
    if (segment.type !== 'mention') return highlightedText(segment.value, start, highlightRange, `text-${index}`);

    const highlighted = highlightRange && start < highlightRange.end && offset > highlightRange.start;
    const chip = <span className="script-mention-chip" data-mention-display data-mention-value={segment.value} key={`mention-${index}`}>
      {segment.imageUrl ? <img src={segment.imageUrl} alt="" loading="lazy" /> : <span className="script-mention-chip-placeholder" aria-hidden="true">{segment.kind === 'scene' ? '景' : '人'}</span>}
      <span>@{segment.name}</span>
    </span>;
    return highlighted ? <mark className="shot-output-card-match" key={`highlight-${index}`}>{chip}</mark> : chip;
  })}</>;
}
