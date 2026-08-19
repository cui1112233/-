package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"qiantie/backend/internal/shuihuo/domain"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
)

var ErrInvalidObjectCleanup = fmt.Errorf("invalid deferred object cleanup")

// ObjectCleanups stores object deletions that must survive a failed request.
// The entries intentionally remain independent of projects: a failed import
// can remove its project row before the object storage operation is retried.
type ObjectCleanups struct{ db *sql.DB }

func NewObjectCleanups(db *sql.DB) *ObjectCleanups { return &ObjectCleanups{db: db} }

func (s *ObjectCleanups) Schedule(ctx context.Context, objectKey, reason string) error {
	if !shuihuostorage.ValidObjectKey(objectKey) || strings.TrimSpace(reason) == "" || len(reason) > 128 {
		return ErrInvalidObjectCleanup
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO shuihuo_object_cleanup_queue(object_key, reason)
VALUES(?, ?)
ON DUPLICATE KEY UPDATE reason = VALUES(reason)
`, objectKey, reason)
	return err
}

func (s *ObjectCleanups) Remove(ctx context.Context, objectKey string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM shuihuo_object_cleanup_queue WHERE object_key = ?`, objectKey)
	if err != nil {
		return err
	}
	return nil
}

func (s *ObjectCleanups) RecordAttemptFailure(ctx context.Context, objectKey string, deleteErr error) error {
	if deleteErr == nil {
		return ErrInvalidObjectCleanup
	}
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_object_cleanup_queue
SET attempt_count = attempt_count + 1, last_error = ?, last_attempt_at = ?
WHERE object_key = ?
`, truncateObjectCleanupError(deleteErr.Error()), time.Now().UTC(), objectKey)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *ObjectCleanups) List(ctx context.Context, limit int) ([]domain.ObjectCleanup, error) {
	if limit < 1 || limit > 500 {
		return nil, ErrInvalidObjectCleanup
	}
	rows, err := s.db.QueryContext(ctx, `
	SELECT id, object_key, reason, last_error, attempt_count, created_at, last_attempt_at, lease_token, lease_expires_at
FROM shuihuo_object_cleanup_queue
ORDER BY created_at ASC, id ASC
LIMIT ?
`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ObjectCleanup, 0)
	for rows.Next() {
		var item domain.ObjectCleanup
		if err := rows.Scan(&item.ID, &item.ObjectKey, &item.Reason, &item.LastError, &item.AttemptCount, &item.CreatedAt, &item.LastAttemptAt, &item.LeaseToken, &item.LeaseExpiresAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// Claim leases a batch before callers contact object storage. The atomic
// conditional update makes concurrent admin runners disjoint without holding
// a database transaction open during a remote delete.
func (s *ObjectCleanups) Claim(ctx context.Context, limit int, token string, now time.Time, lease time.Duration) ([]domain.ObjectCleanup, error) {
	if limit < 1 || limit > 500 || strings.TrimSpace(token) == "" || lease <= 0 {
		return nil, ErrInvalidObjectCleanup
	}
	expiresAt := now.UTC().Add(lease)
	if _, err := s.db.ExecContext(ctx, `
	UPDATE shuihuo_object_cleanup_queue
	SET lease_token = ?, lease_expires_at = ?
	WHERE lease_expires_at IS NULL OR lease_expires_at < ?
	ORDER BY created_at ASC, id ASC
	LIMIT ?`, token, expiresAt, now.UTC(), limit); err != nil {
		return nil, err
	}
	return s.listClaimed(ctx, token)
}

// ClaimKey gives synchronous compensation the same lease protection as the
// administrator runner. A false result means another cleaner owns the key.
func (s *ObjectCleanups) ClaimKey(ctx context.Context, objectKey, token string, now time.Time, lease time.Duration) (bool, error) {
	if !shuihuostorage.ValidObjectKey(objectKey) || strings.TrimSpace(token) == "" || lease <= 0 {
		return false, ErrInvalidObjectCleanup
	}
	result, err := s.db.ExecContext(ctx, `
	UPDATE shuihuo_object_cleanup_queue
	SET lease_token = ?, lease_expires_at = ?
	WHERE object_key = ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)`, token, now.UTC().Add(lease), objectKey, now.UTC())
	if err != nil {
		return false, err
	}
	return affected(result)
}

// RenewClaim extends an existing lease immediately before a remote delete.
// A false result means another runner has claimed the entry, so the caller
// must skip the delete rather than acting on a stale batch item.
func (s *ObjectCleanups) RenewClaim(ctx context.Context, objectKey, token string, now time.Time, lease time.Duration) (bool, error) {
	if !shuihuostorage.ValidObjectKey(objectKey) || strings.TrimSpace(token) == "" || lease <= 0 {
		return false, ErrInvalidObjectCleanup
	}
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_object_cleanup_queue
SET lease_expires_at = ?
WHERE object_key = ? AND lease_token = ?`, now.UTC().Add(lease), objectKey, token)
	if err != nil {
		return false, err
	}
	return affected(result)
}

func (s *ObjectCleanups) RemoveClaimed(ctx context.Context, objectKey, token string) (bool, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM shuihuo_object_cleanup_queue WHERE object_key = ? AND lease_token = ?`, objectKey, token)
	if err != nil {
		return false, err
	}
	return affected(result)
}

func (s *ObjectCleanups) RecordClaimFailure(ctx context.Context, objectKey, token string, deleteErr error) (bool, error) {
	if deleteErr == nil {
		return false, ErrInvalidObjectCleanup
	}
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_object_cleanup_queue
SET attempt_count = attempt_count + 1, last_error = ?, last_attempt_at = ?, lease_token = '', lease_expires_at = NULL
WHERE object_key = ? AND lease_token = ?`, truncateObjectCleanupError(deleteErr.Error()), time.Now().UTC(), objectKey, token)
	if err != nil {
		return false, err
	}
	return affected(result)
}

func (s *ObjectCleanups) listClaimed(ctx context.Context, token string) ([]domain.ObjectCleanup, error) {
	rows, err := s.db.QueryContext(ctx, `
	SELECT id, object_key, reason, last_error, attempt_count, created_at, last_attempt_at, lease_token, lease_expires_at
	FROM shuihuo_object_cleanup_queue
	WHERE lease_token = ?
	ORDER BY created_at ASC, id ASC`, token)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ObjectCleanup, 0)
	for rows.Next() {
		var item domain.ObjectCleanup
		if err := rows.Scan(&item.ID, &item.ObjectKey, &item.Reason, &item.LastError, &item.AttemptCount, &item.CreatedAt, &item.LastAttemptAt, &item.LeaseToken, &item.LeaseExpiresAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ImportCleanups persists failed-import teardown until the staging project can
// be removed. Its project foreign key cascades the record away after success.
type ImportCleanups struct{ db *sql.DB }

func NewImportCleanups(db *sql.DB) *ImportCleanups { return &ImportCleanups{db: db} }

func (s *ImportCleanups) Schedule(ctx context.Context, item domain.ImportCleanup) error {
	if item.ProjectID < 1 || item.UserID < 1 || strings.TrimSpace(item.Reason) == "" || len(item.Reason) > 128 || (item.ObjectKey != "" && !shuihuostorage.ValidObjectKey(item.ObjectKey)) {
		return ErrInvalidObjectCleanup
	}
	_, err := s.db.ExecContext(ctx, `
	INSERT INTO shuihuo_import_compensation_queue(project_id, user_id, object_key, reason)
	VALUES(?, ?, ?, ?)
	ON DUPLICATE KEY UPDATE object_key = VALUES(object_key), reason = VALUES(reason)`, item.ProjectID, item.UserID, item.ObjectKey, item.Reason)
	return err
}

func (s *ImportCleanups) RecordAttemptFailure(ctx context.Context, projectID int64, cleanupErr error) error {
	if projectID < 1 || cleanupErr == nil {
		return ErrInvalidObjectCleanup
	}
	_, err := s.db.ExecContext(ctx, `
	UPDATE shuihuo_import_compensation_queue
	SET attempt_count = attempt_count + 1, last_error = ?, last_attempt_at = ?
	WHERE project_id = ?`, truncateObjectCleanupError(cleanupErr.Error()), time.Now().UTC(), projectID)
	return err
}

func (s *ImportCleanups) Remove(ctx context.Context, projectID int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM shuihuo_import_compensation_queue WHERE project_id = ?`, projectID)
	return err
}

func (s *ImportCleanups) List(ctx context.Context, limit int) ([]domain.ImportCleanup, error) {
	if limit < 1 || limit > 500 {
		return nil, ErrInvalidObjectCleanup
	}
	rows, err := s.db.QueryContext(ctx, `
	SELECT project_id, user_id, object_key, reason, last_error, attempt_count, created_at, last_attempt_at
	FROM shuihuo_import_compensation_queue
	ORDER BY created_at ASC, project_id ASC
	LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ImportCleanup, 0)
	for rows.Next() {
		var item domain.ImportCleanup
		if err := rows.Scan(&item.ProjectID, &item.UserID, &item.ObjectKey, &item.Reason, &item.LastError, &item.AttemptCount, &item.CreatedAt, &item.LastAttemptAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func affected(result sql.Result) (bool, error) {
	count, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func truncateObjectCleanupError(value string) string {
	const maxLength = 2048
	if len(value) <= maxLength {
		return value
	}
	return value[:maxLength]
}
