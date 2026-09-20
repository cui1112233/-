export async function measureH3VideoLines({ directorId, document, tts, previous, synthesize, encode, measure }) {
  const cards = document?.director_cards || [];
  if (!cards.length || cards.some(card => !card.source_key || !String(card.source_text || '').trim())) throw new Error('缺少冻结的视频原文行');
  // Include all resolved provider settings, not just a few visible controls.
  const configBytes = new TextEncoder().encode(JSON.stringify(Object.keys(tts || {}).sort().map(key => [key, tts[key]])));
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', configBytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (previous?.method === 'per_line_tts_probe' && previous.asset_id &&
      previous.video_source_hash === document.video_source_hash && previous.video_source_revision === document.video_source_revision &&
      previous.tts_fingerprint === fingerprint && previous.lines?.length === cards.length &&
      previous.lines.every((line, i) => line.source_key === cards[i].source_key && line.source_text_hash === cards[i].source_text_hash && line.duration_ms > 0)) {
    return { audio_asset_id: previous.asset_id, audio_measurement: { measurement: previous } };
  }
  const lines = [];
  for (const card of cards) {
    const blob = await synthesize({ ...tts, input: card.source_text });
    lines.push({ source_key: card.source_key, source_text: card.source_text, audio_base64: await encode(blob) });
  }
  return measure({ director_revision_id: directorId, tts_fingerprint: fingerprint, lines });
}
