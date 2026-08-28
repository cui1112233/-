function materialVersion(previous, next) {
  const current = Number.isInteger(Number(previous?.version)) ? Number(previous.version) : 0;
  return current + 1;
}
function buildHistoryVersionFields(record = {}) {
  const material = record.material && typeof record.material === 'object' ? record.material : (record.extractInfo || null);
  const version = Number.isInteger(Number(record.materialVersion)) ? Number(record.materialVersion) : Number(material?.version) || 0;
  return { ...(version > 0 ? { materialVersion: version } : {}), ...(material ? { material } : {}), sourceText: typeof record.sourceText === 'string' ? record.sourceText : (typeof record.novelText === 'string' ? record.novelText : ''), output: typeof record.output === 'string' ? record.output : '', ...(record.previousOutputId ? { previousOutputId: String(record.previousOutputId) } : {}) };
}
function commitRegeneration(current, candidate, error) { if (error || !candidate || typeof candidate.output !== 'string' || !candidate.output.trim()) return current; return candidate; }
module.exports = { materialVersion, buildHistoryVersionFields, commitRegeneration };
