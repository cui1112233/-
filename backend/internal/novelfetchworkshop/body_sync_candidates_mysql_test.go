package novelfetchworkshop

import (
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestMySQLBodySyncCandidatesQueryReadyBodiesByOwner(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)
	query := `SELECT book_id, version_id, revision, content_hash, char_count, state, updated_at
FROM novel_fetch_workshop_bodies
WHERE owner_username=? AND state='ready'
ORDER BY updated_at ASC, book_id ASC, version_id ASC
LIMIT ?`
	mock.ExpectQuery(regexp.QuoteMeta(query)).
		WithArgs("alice", 25).
		WillReturnRows(sqlmock.NewRows([]string{"book_id", "version_id", "revision", "content_hash", "char_count", "state", "updated_at"}).
			AddRow("book-a", "ai3", uint64(4), "hash-a", uint64(1234), "ready", now))

	store := NewMySQLStore(db)
	items, err := store.ListBodySyncCandidates(t.Context(), "alice", 25)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("items=%+v", items)
	}
	item := items[0]
	if item.BookID != "book-a" || item.VersionID != "ai3" || item.Revision != 4 || item.ContentHash != "hash-a" || item.CharCount != 1234 || item.State != "ready" {
		t.Fatalf("candidate=%+v", item)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
