#!/usr/bin/env node
// One-off production recovery: use canonical publisher, retain preset settings,
// require remote readback, and persist receipts through optimistic metadata API.
const fs = require('node:fs');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const { createBatchFactory121Publisher } = require('../../lib/batch-factory-v11/121-publisher');
const { create121DirectClient } = require('../../lib/novel-fetch-workshop/121-direct-client');

async function main() {
  const [owner, batchId] = process.argv.slice(2);
  if (!/^[a-zA-Z0-9_-]+$/.test(owner || '') || !/^batch_[a-f0-9]+$/.test(batchId || '')) throw new Error('Explicit user and batch required');
  const root = '/var/lib/docker/volumes/v88-public_v88_data/_data';
  const container = JSON.parse(cp.execFileSync('docker', ['inspect', 'v88-public-go-api-1']))[0];
  const env = Object.fromEntries(container.Config.Env.map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  const ip = Object.values(container.NetworkSettings.Networks)[0].IPAddress;
  async function api(url, method = 'GET', data, binary = false) {
    const issued = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', env.QIANTIE_BRIDGE_SECRET).update(owner + issued + 'false' + method + url).digest('hex');
    const response = await fetch('http://' + ip + ':3000' + url, { method, headers: {
      'Content-Type': 'application/json', 'X-Qiantie-Username': owner, 'X-Qiantie-Is-Owner': 'false',
      'X-Qiantie-Issued-At': issued, 'X-Qiantie-Signature': signature
    }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error('Managed API HTTP ' + response.status);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  }
  const directClient = create121DirectClient();
  const session = JSON.parse(fs.readFileSync(path.join(root, 'users', owner, 'upload-target.json')));
  await directClient.verify({ cookie: session.cookie });
  const base = '/api/batch-factory/v12/batches/' + batchId;
  const publisher = createBatchFactory121Publisher({
    loadBatch: () => api(base), loadMergeStatus: () => api(base + '/merge-status'),
    loadProductionStatus: () => api(base + '/status'),
    fetchMedia: (_, url) => {
      if (!url.startsWith(base + '/merge-media/')) throw new Error('Unmanaged media refused');
      return api(url, 'GET', undefined, true);
    },
    getSession: async () => session, directClient,
    onProgress: async p => console.log(owner, p.phase, p.message)
  });
  const backup = '/opt/qiantie/backups/automation/publish-' + owner + '-' + Date.now();
  fs.mkdirSync(backup, { mode: 0o700 });
  const loaded = await api(base);
  for (const book of (loaded.batch || loaded).books) {
    try {
      if (book.sourceMetadata?.websiteSubmitReceipt?.status === 'confirmed' && book.sourceMetadata?.recoveryPresetVerified === true) {
        console.log(owner, book.id, 'already confirmed'); continue;
      }
      const merge = await api(base + '/merge-status');
      const settings = { ...(loaded.batch || loaded).settingsState.patch, ...book.settingsState.patch };
      const required = settings.openingEnabled ? Number(settings.openingCount || 1) : 1;
      const completed = new Set(merge.jobs.filter(j => j.bookId === book.id && j.status === 'succeeded').map(j => j.openingVariantIndex || 0));
      if (completed.size < required) { console.log(owner, book.id, 'waiting for all merged variants'); continue; }
      fs.writeFileSync(path.join(backup, book.id + '-metadata.json'), JSON.stringify(book.sourceMetadata), { mode: 0o600, flag: 'wx' });
      const result = await publisher.submit(owner, { batchId, bookId: book.id }, {
        organization: settings.publishSettings?.organization, category: settings.publishSettings?.category || 'NEW_BOOK',
        startTime: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
      });
      fs.writeFileSync(path.join(backup, book.id + '-receipt.json'), JSON.stringify(result), { mode: 0o600, flag: 'wx' });
      const remote = result.receipt?.remote_record;
      const confirmed = result.receipt?.verified === true && remote?.found === true && remote.mismatches?.length === 0;
      const latest = await api(base);
      const current = (latest.batch || latest).books.find(b => b.id === book.id);
      const metadata = { ...current.sourceMetadata,
        publishStatus: confirmed ? 'uploaded' : 'submitted', websiteSubmitStatus: confirmed ? 'uploaded' : 'submitted',
        recoveryPresetVerified: confirmed, websiteSubmitReceipt: { status: confirmed ? 'confirmed' : 'accepted_pending',
          remoteId: String(remote?.remote_id || ''), remoteTime: String(remote?.remote_time || ''), detail: remote?.detail || '' },
        websiteSubmitProgress: { phase: 'readback', status: confirmed ? 'succeeded' : 'waiting', message: remote?.detail || '', updatedAt: result.uploadedAt },
        websiteSubmitHistory: [...(current.sourceMetadata?.websiteSubmitHistory || []), {
          submittedAt: result.uploadedAt, status: confirmed ? 'confirmed' : 'accepted_pending', sourceTextFile: result.sourceTextFile,
          aiHeadVideoFiles: result.aiHeadVideoFiles, remoteId: String(remote?.remote_id || '') }]
      };
      await api(base + '/books/' + book.id + '/metadata', 'PUT', { metadata, expectedRevision: current.revision });
      console.log(owner, book.id, confirmed ? 'CONFIRMED' : 'PENDING', 'heads', result.aiHeadVideoFiles?.length, 'remote', remote?.remote_id, 'mismatches', JSON.stringify(remote?.mismatches));
      if (!confirmed) throw new Error('Upload readback did not verify preset; receipt retained');
    } catch (error) {
      console.log(owner, book.id, 'FAILED', error.message);
      // No automatic replay after any uncertain external submission.
      throw error;
    }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
