# Batch merge artifact retention design

## Goal

Make deletion of a Batch Factory book or project release its local merged MP4
after the owner-selected retention period. The public default is three days.
The database record is still deleted immediately; only the physical merge
artifact is delayed.

## Confirmed facts and scope

- Public local merge output is written as `merge_<id>.mp4` to the Go artifact
  volume. It currently uses about 2.2 GB.
- Deleting a batch currently deletes MySQL rows but does not remove that file.
- TOS is not configured on the public Go service. This delivery must not claim
  remote-object deletion or change any external 121 publication.
- User-provided images, executor video artifacts, active work, references and
  uploads are outside this cleanup scope.

## Design

Before a MySQL delete removes the merge-job rows, it records each matching
local merged MP4 into a durable purge ledger with the owner, project/book
identity, file name and `purge_after` timestamp. The delete and ledger write
share one transaction, so a failed delete never creates a misleading purge.

A Go worker runs at startup and periodically. It claims only due, pending
ledger rows, removes only the stored `merge_*.mp4` reference through the
root-confined artifact store, and records either `deleted` or a retryable
failure. A missing file counts as deleted. It cannot traverse out of the
artifact directory.

The Node V12 deletion proxy supplies the signed-in user's selected retention
days. Settings accept 3, 7, 14 or 30 days, with 3 as the default. Direct Go
deletion requests use the same three-day default. UI wording will state that
only local merged MP4s are covered and that TOS is not configured.

## Safety boundaries

- Never delete on discovery alone: only files ledgered by a successful delete
  request are eligible.
- Never delete a remote TOS object in this change.
- Never delete any item until `purge_after` is due.
- Deletion remains owner-scoped; the ledger is auditable after project rows
  are gone.
- A failed local remove is retried without restoring a deleted project.

## Acceptance criteria

1. Deleting a project with a local merged artifact creates one pending ledger
   row and removes the project database records.
2. The artifact remains readable before the three-day deadline.
3. A due entry removes only its exact `merge_*.mp4`; missing files resolve
   successfully and invalid file names are rejected.
4. A failed filesystem delete remains retryable and is visible in the ledger.
5. Public build identity is the committed V88 SHA; a test delete proves the
   ledger and physical-file outcome without touching other users' artifacts.
