package localexecutor

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"qiantie/backend/internal/novelfetchworkshop"
)

func TestMySQLBodySyncFirstClaimPersistsLease(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewMySQLStore(db)
	now := time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)
	expires := now.Add(BodySyncLeaseTTL)
	executor := ExecutorRecord{ID: "lex_alice", OwnerUsername: "alice"}
	body := novelfetchworkshop.BodyRecord{BookID: "book-a", BodyRef: novelfetchworkshop.BodyRef{VersionID: "ai3", Revision: 4, ContentHash: "hash-a"}}
	leaseHash := hashSecret("lease-a")

	mock.ExpectBegin()
	insert := `INSERT IGNORE INTO local_executor_body_syncs
(id, owner_username, book_id, version_id, body_revision, content_hash, state,
 lease_executor_id, lease_token_hash, lease_generation, lease_expires_at, acked_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)`
	mock.ExpectExec(regexp.QuoteMeta(insert)).
		WithArgs("lbs_1", "alice", "book-a", "ai3", uint64(4), "hash-a", BodySyncLeased, "lex_alice", leaseHash[:], expires, now, now).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	record, err := store.ClaimBodySync(context.Background(), executor, "lbs_1", body, leaseHash, expires, now)
	if err != nil {
		t.Fatal(err)
	}
	if record.ID != "lbs_1" || record.LeaseGeneration != 1 || record.LeaseExecutorID != "lex_alice" || record.State != BodySyncLeased || record.LeaseExpiresAt == nil || !record.LeaseExpiresAt.Equal(expires) {
		t.Fatalf("record=%+v", record)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestMySQLBodySyncAckValidatesLeaseAndPersistsAck(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewMySQLStore(db)
	now := time.Date(2026, 9, 3, 10, 0, 30, 0, time.UTC)
	expires := now.Add(30 * time.Second)
	executor := ExecutorRecord{ID: "lex_alice", OwnerUsername: "alice"}
	leaseHash := hashSecret("lease-a")

	mock.ExpectBegin()
	selectSQL := `SELECT id, owner_username, book_id, version_id, body_revision, content_hash, state,
 lease_executor_id, lease_token_hash, lease_generation, lease_expires_at, acked_at, created_at, updated_at
FROM local_executor_body_syncs
WHERE id = ? AND owner_username = ? FOR UPDATE`
	mock.ExpectQuery(regexp.QuoteMeta(selectSQL)).
		WithArgs("lbs_1", "alice").
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_username", "book_id", "version_id", "body_revision", "content_hash", "state", "lease_executor_id", "lease_token_hash", "lease_generation", "lease_expires_at", "acked_at", "created_at", "updated_at"}).
			AddRow("lbs_1", "alice", "book-a", "ai3", uint64(4), "hash-a", BodySyncLeased, "lex_alice", leaseHash[:], int64(1), expires, nil, now.Add(-time.Minute), now.Add(-time.Minute)))
	update := `UPDATE local_executor_body_syncs SET state = ?, acked_at = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ?`
	mock.ExpectExec(regexp.QuoteMeta(update)).
		WithArgs(BodySyncAcked, now, now, "lbs_1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	record, err := store.AckBodySync(context.Background(), executor, "lbs_1", leaseHash, 1, 4, "hash-a", now)
	if err != nil {
		t.Fatal(err)
	}
	if record.State != BodySyncAcked || record.AckedAt == nil || !record.AckedAt.Equal(now) || record.LeaseExpiresAt != nil {
		t.Fatalf("record=%+v", record)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
