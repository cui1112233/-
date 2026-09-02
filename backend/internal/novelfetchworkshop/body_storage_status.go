package novelfetchworkshop

import (
	"context"
	"time"
)

type BodyStorageStatus struct {
	BodyCount       int64 `json:"bodyCount"`
	StorageBytes    int64 `json:"storageBytes"`
	CharCount       int64 `json:"charCount"`
	ReleasableCount int64 `json:"releasableCount"`
	ExpiredCount    int64 `json:"expiredCount"`
}

func (s *MemoryStore) GetBodyStorageStatus(_ context.Context, owner string, now time.Time) (BodyStorageStatus, error) {
	now = normalizeCleanupNow(now)
	s.mu.RLock()
	defer s.mu.RUnlock()

	var status BodyStorageStatus
	for _, versions := range s.bodies[owner] {
		for _, body := range versions {
			blob, _, _, err := encodeBody(body.Content)
			if err != nil {
				return BodyStorageStatus{}, err
			}
			status.BodyCount++
			status.StorageBytes += int64(len(blob))
			status.CharCount += body.CharCount
			if body.State != "releasable" {
				continue
			}
			status.ReleasableCount++
			expiresAt, ok := parseLifecycleTime(body.ExpiresAt)
			if ok && !expiresAt.After(now) {
				status.ExpiredCount++
			}
		}
	}
	return status, nil
}

func (s *MySQLStore) GetBodyStorageStatus(ctx context.Context, owner string, now time.Time) (BodyStorageStatus, error) {
	now = normalizeCleanupNow(now)
	var status BodyStorageStatus
	err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(OCTET_LENGTH(content_blob)),0), COALESCE(SUM(char_count),0), COALESCE(SUM(CASE WHEN state='releasable' THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN state='releasable' AND expires_at IS NOT NULL AND expires_at<=? THEN 1 ELSE 0 END),0) FROM novel_fetch_workshop_bodies WHERE owner_username=?`, now, owner).Scan(
		&status.BodyCount,
		&status.StorageBytes,
		&status.CharCount,
		&status.ReleasableCount,
		&status.ExpiredCount,
	)
	if err != nil {
		return BodyStorageStatus{}, err
	}
	return status, nil
}
