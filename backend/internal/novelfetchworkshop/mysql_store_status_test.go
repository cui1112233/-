package novelfetchworkshop

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestMySQLStoreBodyStorageStatusUsesCompressedBodyBytes(t *testing.T) {
	_, mock, store := newBodySQLMock(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 2, 16, 45, 0, 0, time.UTC)

	query := `SELECT COUNT(*), COALESCE(SUM(OCTET_LENGTH(content_blob)),0), COALESCE(SUM(char_count),0), COALESCE(SUM(CASE WHEN state='releasable' THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN state='releasable' AND expires_at IS NOT NULL AND expires_at<=? THEN 1 ELSE 0 END),0) FROM novel_fetch_workshop_bodies WHERE owner_username=?`
	mock.ExpectQuery(regexp.QuoteMeta(query)).
		WithArgs(now, "alice").
		WillReturnRows(sqlmock.NewRows([]string{"count", "bytes", "chars", "releasable", "expired"}).AddRow(9, 4096, 12000, 4, 2))

	status, err := store.GetBodyStorageStatus(ctx, "alice", now)
	if err != nil {
		t.Fatal(err)
	}
	if status.BodyCount != 9 || status.StorageBytes != 4096 || status.CharCount != 12000 || status.ReleasableCount != 4 || status.ExpiredCount != 2 {
		t.Fatalf("status=%+v", status)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
