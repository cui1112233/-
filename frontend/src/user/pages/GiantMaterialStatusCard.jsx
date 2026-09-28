const PHASES = {
  idle: { label: '待执行', tone: 'muted' },
  resolving: { label: '连接中', tone: 'loading' },
  reading: { label: '读取中', tone: 'loading' },
  ocr: { label: '识别中', tone: 'loading' },
  cleaning: { label: '整理中', tone: 'loading' },
  success: { label: '已完成', tone: 'success' },
  error: { label: '失败', tone: 'error' },
  cancelled: { label: '已取消', tone: 'warning' }
};

function boundedProgress(progress) {
  if (!progress) return null;
  const max = Math.max(1, Number(progress.max) || 1);
  const value = Math.min(max, Math.max(0, Number(progress.value) || 0));
  return { max, value, indeterminate: Boolean(progress.indeterminate) };
}

export function GiantMaterialStatusCard({
  title = '滚屏 OCR',
  phase = 'idle',
  detail = '',
  progress = null,
  stats = [],
  compact = false,
  error = ''
}) {
  const meta = PHASES[phase] || PHASES.idle;
  const safeProgress = boundedProgress(progress);
  const safeStats = Array.isArray(stats) ? stats.filter(Boolean) : [];
  const safeDetail = String(error || detail || '').trim();

  return <section className={`giant-material-status-card is-${meta.tone}${compact ? ' is-compact' : ''}`} aria-live={meta.tone === 'loading' ? 'polite' : 'assertive'}>
    <div className="giant-material-status-heading"><strong>{title}</strong><span>{meta.label}</span></div>
    {safeDetail ? <p>{safeDetail}</p> : null}
    {safeProgress ? <progress
      aria-label={`${title}进度`}
      max={safeProgress.max}
      value={safeProgress.indeterminate ? undefined : safeProgress.value}
    /> : null}
    {safeStats.length ? <div className="giant-material-status-stats">{safeStats.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div> : null}
  </section>;
}

export { PHASES };
export default GiantMaterialStatusCard;
