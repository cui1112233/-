# Batch merged-video TOS retention design

## Goal

Store Batch Factory merged MP4 files in the existing TOS bucket before their
local artifact is removed. A failed or unverified upload must retain the local
artifact and leave the existing merge result unchanged.

## Chosen design

The local merge adapter remains responsible for downloading and joining clips,
but its successful output is written to `batch-merged/` in TOS before the
temporary working directory is removed. The merge job stores the TOS URL only
after the upload succeeds. This avoids persisting another local finished MP4
for newly merged books.

Existing local merged artifacts are migrated through an owner-scoped recovery
operation: upload the exact stored MP4, verify its resulting URL, update the
merge job, then remove only that artifact. If any step fails, the source file
and current job URL are retained.

## Safety rules

- Never delete a local artifact before a successful TOS write and URL check.
- Only migrate artifacts belonging to the requesting account and matching a
  completed merge job.
- Use the existing TOS bucket under the `batch-merged/` prefix; do not touch
  reference assets or unrelated object keys.
- Keep the current `video_no_submit` behaviour: TOS storage is not submission
  to the video management system.

## Verification

- A failed upload leaves the local merge artifact and existing merge URL.
- A successful upload produces a `batch-merged/` TOS URL and removes the local
  artifact only after job persistence.
- Existing owner-scoped merged artifacts can be migrated, while foreign or
  malformed references are rejected.
