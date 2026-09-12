function publicMedia(item) {
  return item?.media || item;
}

export function primaryAudioForSegment(media, segmentId) {
  const audio = (media || []).map(publicMedia)
    .filter(item => item?.kind === 'audio' && item.segmentId === segmentId);

  return audio.find(item => item.isPrimary === true) || audio[0] || null;
}
