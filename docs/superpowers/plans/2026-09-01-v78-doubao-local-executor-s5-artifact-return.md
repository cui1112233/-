# V78 Doubao Local Executor S5 — Artifact Return Plan

**Date:** 2026-09-01

## Goal

Return the exact MP4 produced by the accepted Doubao submission from the local executor to V78 without regenerating, mixing tasks, or buffering the whole video in JSON.

## User-visible outcome

After this slice is integrated with the live Doubao adapter, a VIDEO task can move from `downloading` to `uploading`, upload the validated MP4 to V78, receive an artifact ID, and then complete the original job with that artifact ID.

## Contract

1. The executor uploads binary `video/mp4` bytes to a job-scoped device endpoint.
2. Device bearer authentication remains required.
3. The active lease token and generation accompany the binary upload in headers.
4. The server rejects cancelled jobs, stale leases, unaccepted jobs, wrong executor ownership, invalid MP4, and oversized uploads.
5. The server computes byte size and SHA-256 itself; client metadata is never trusted as authoritative.
6. Upload is idempotent for the same job/content hash.
7. A different payload for a job that already owns an artifact fails closed.
8. Retry of upload never calls Doubao generation again.
9. Node forwards MP4 as a stream; it must not convert video bytes to JSON/base64.
10. The existing `/jobs/{id}/result` call remains the terminal step and receives the stored artifact ID.

## Device API

`POST /api/local-executor/v1/jobs/{jobId}/artifact`

Headers:
- `Authorization: Bearer <device-token>`
- `Content-Type: video/mp4`
- `X-Lease-Token: <lease-token>`
- `X-Lease-Generation: <integer>`

Success response:

```json
{
  "artifactId": "...",
  "mediaType": "video/mp4",
  "byteSize": 123,
  "sha256": "..."
}
```

## Execution order

1. Add executor API-client upload contract test (RED), then implement raw MP4 upload (GREEN).
2. Add Node proxy tests proving MP4 bytes and lease headers are forwarded unchanged, then add streaming forwarding.
3. Add Go artifact domain tests for accepted-only, lease/cancel checks, idempotency and content conflict.
4. Add filesystem-backed artifact storage plus MySQL metadata persistence.
5. Add Go HTTP upload endpoint and tests, including MP4 validation and size cap.
6. Change the live adapter/job runner handoff so `fetchArtifact` returns a validated local file and the executor uploads it before `/result`.
7. Verify Node tests, Go tests, executor tests and syntax checks.

## Not in this slice

- Do not change legacy `0.1.14` download links yet.
- Do not enable production job claiming until the live Doubao adapter and artifact return both pass controlled end-to-end acceptance.
- Do not use the fake Doubao adapter for production completion.
