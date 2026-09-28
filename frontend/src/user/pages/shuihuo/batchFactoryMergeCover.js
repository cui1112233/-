function text(value) {
  return String(value ?? '').trim();
}

function coverURL(outputURL) {
  return outputURL.replace(/\/merge-media\/([^/]+)$/, '/merge-cover/$1');
}

// A final merged output is a valid card cover only after ordinary shot-video
// selection has had priority. The caller keeps that ordering explicit.
export function batchFactoryMergeCoverFrom(batch, mergeStatus) {
  const jobs = Array.isArray(mergeStatus?.jobs) ? mergeStatus.jobs : [];
  const firstBookID = text(batch?.books?.[0]?.id);
  const completedForFirstBook = jobs.find(job => text(job?.bookId) === firstBookID && job?.status === 'succeeded' && text(job?.outputUrl));
  const completed = completedForFirstBook || jobs.find(job => job?.status === 'succeeded' && text(job?.outputUrl));
  const outputURL = text(completed?.outputUrl);
  return outputURL ? { kind: 'image', url: coverURL(outputURL) } : null;
}
