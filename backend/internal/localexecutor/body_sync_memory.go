package localexecutor

import (
	"context"
	"crypto/hmac"
	"sync"
	"time"

	"qiantie/backend/internal/novelfetchworkshop"
)

type MemoryBodySyncStore struct {
	mu      sync.Mutex
	records map[string]BodySyncRecord
	keys    map[string]string
}

func NewMemoryBodySyncStore() *MemoryBodySyncStore {
	return &MemoryBodySyncStore{records: map[string]BodySyncRecord{}, keys: map[string]string{}}
}

func bodySyncKey(owner, bookID, versionID string, revision uint64) string {
	return owner + "\x00" + bookID + "\x00" + versionID + "\x00" + string(rune(revision))
}

func (s *MemoryBodySyncStore) ClaimBodySync(_ context.Context, executor ExecutorRecord, syncID string, body novelfetchworkshop.BodyRecord, leaseHash SecretHash, expires, now time.Time) (BodySyncRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := bodySyncKey(executor.OwnerUsername, body.BookID, body.VersionID, body.Revision)
	if existingID, ok := s.keys[key]; ok {
		record := s.records[existingID]
		if record.State == BodySyncAcked {
			return BodySyncRecord{}, ErrBodySyncAlreadyAcked
		}
		if record.LeaseExpiresAt != nil && record.LeaseExpiresAt.After(now) {
			return BodySyncRecord{}, ErrBodySyncLeaseBusy
		}
		record.State = BodySyncLeased
		record.LeaseExecutorID = executor.ID
		record.LeaseTokenHash = leaseHash
		record.LeaseGeneration++
		record.LeaseExpiresAt = timePtr(expires)
		record.UpdatedAt = now
		s.records[existingID] = record
		return record, nil
	}

	record := BodySyncRecord{
		ID: syncID, OwnerUsername: executor.OwnerUsername, BookID: body.BookID, VersionID: body.VersionID,
		BodyRevision: body.Revision, ContentHash: body.ContentHash, State: BodySyncLeased,
		LeaseExecutorID: executor.ID, LeaseTokenHash: leaseHash, LeaseGeneration: 1,
		LeaseExpiresAt: timePtr(expires), CreatedAt: now, UpdatedAt: now,
	}
	s.records[record.ID] = record
	s.keys[key] = record.ID
	return record, nil
}

func (s *MemoryBodySyncStore) AckBodySync(_ context.Context, executor ExecutorRecord, syncID string, leaseHash SecretHash, generation int64, revision uint64, contentHash string, now time.Time) (BodySyncRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	record, ok := s.records[syncID]
	if !ok || record.OwnerUsername != executor.OwnerUsername || record.LeaseExecutorID != executor.ID || record.State != BodySyncLeased {
		return BodySyncRecord{}, ErrStaleBodySyncLease
	}
	if record.LeaseGeneration != generation || !hmac.Equal(record.LeaseTokenHash[:], leaseHash[:]) || record.LeaseExpiresAt == nil || !record.LeaseExpiresAt.After(now) {
		return BodySyncRecord{}, ErrStaleBodySyncLease
	}
	if record.BodyRevision != revision || record.ContentHash != contentHash {
		return BodySyncRecord{}, ErrBodySyncIntegrity
	}
	ackedAt := now
	record.State = BodySyncAcked
	record.AckedAt = &ackedAt
	record.LeaseExpiresAt = nil
	record.UpdatedAt = now
	s.records[syncID] = record
	return record, nil
}

func timePtr(value time.Time) *time.Time {
	copy := value
	return &copy
}
