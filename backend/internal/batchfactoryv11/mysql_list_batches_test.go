package batchfactoryv11

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestMySQLStoreListBatchesReturnsLibrarySummariesWithoutFullSourceHydration(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT b.id,r.title,COALESCE\\(r.source_intake_id,''\\),b.revision,b.created_at,b.updated_at").
		WithArgs("alice").
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "source_intake_id", "revision", "created_at", "updated_at"}).
			AddRow("batch-1", "批量一", "intake-1", int64(7), now, now))
	mock.ExpectQuery("SELECT b.batch_id,b.id,r.title,COALESCE\\(r.source_book_id,''\\),COALESCE\\(r.platform,''\\),b.revision").
		WithArgs("alice").
		WillReturnRows(sqlmock.NewRows([]string{"batch_id", "id", "title", "source_book_id", "platform", "revision"}).
			AddRow("batch-1", "book-1", "小说一", "source-1", "hei-yan", int64(3)))

	batches, err := NewMySQLStore(db).ListBatches(context.Background(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(batches) != 1 || batches[0].ID != "batch-1" || batches[0].Title != "批量一" || batches[0].Revision != 7 {
		t.Fatalf("batch summary = %#v", batches)
	}
	if len(batches[0].Books) != 1 {
		t.Fatalf("books = %#v", batches[0].Books)
	}
	book := batches[0].Books[0]
	if book.ID != "book-1" || book.BookID != "source-1" || book.Title != "小说一" || book.Platform != "hei-yan" || book.SourceText != "" || len(book.Videos) != 0 {
		t.Fatalf("book summary = %#v", book)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReadbackMySQLStoreListBatchesKeepsLibraryReadsSummaryOnly(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT b.id,r.title,COALESCE\\(r.source_intake_id,''\\),b.revision,b.created_at,b.updated_at").
		WithArgs("alice").
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "source_intake_id", "revision", "created_at", "updated_at"}).
			AddRow("batch-1", "批量一", "intake-1", int64(7), now, now))
	mock.ExpectQuery("SELECT b.batch_id,b.id,r.title,COALESCE\\(r.source_book_id,''\\),COALESCE\\(r.platform,''\\),b.revision").
		WithArgs("alice").
		WillReturnRows(sqlmock.NewRows([]string{"batch_id", "id", "title", "source_book_id", "platform", "revision"}).
			AddRow("batch-1", "book-1", "小说一", "source-1", "hei-yan", int64(3)))

	batches, err := NewReadbackMySQLStore(db).ListBatches(context.Background(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(batches) != 1 || batches[0].SettingsState.Patch != nil || len(batches[0].Books) != 1 || batches[0].Books[0].SettingsState.Patch != nil {
		t.Fatalf("library summaries must not hydrate settings: %#v", batches)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
