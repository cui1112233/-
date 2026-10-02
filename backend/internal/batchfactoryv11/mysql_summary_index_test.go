package batchfactoryv11

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestListBatchSummaryIndexReadsOnlyProjectCardFields(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT b.id,r.title,b.revision,b.created_at,b.updated_at FROM batch_factory_v11_batches b JOIN batch_factory_v11_batch_records r ON r.batch_id=b.id WHERE b.owner_username=? ORDER BY b.created_at DESC,b.id DESC`)).
		WithArgs("alice").
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "revision", "created_at", "updated_at"}).
			AddRow("batch-2", "第二批", int64(8), now, now).
			AddRow("batch-1", "第一批", int64(3), now, now))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT b.batch_id,b.id,COALESCE(r.source_book_id,''),COALESCE(r.title,''),COALESCE(r.platform,'') FROM batch_factory_v11_books b JOIN batch_factory_v11_book_records r ON r.book_id=b.id WHERE b.owner_username=? ORDER BY b.batch_id,b.ordinal,b.id`)).
		WithArgs("alice").
		WillReturnRows(sqlmock.NewRows([]string{"batch_id", "id", "book_id", "title", "platform"}).
			AddRow("batch-1", "book-1", "558154", "后来情深情亦浅", "七猫").
			AddRow("batch-2", "book-2", "1201790", "第二通电话", "七猫"))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT j.batch_id,j.id FROM batch_factory_v11_merge_jobs j LEFT JOIN batch_factory_v11_books b ON b.id=j.book_id AND b.owner_username=j.owner_username WHERE j.owner_username=? AND j.status='succeeded' AND COALESCE(j.output_url,'')<>'' ORDER BY j.batch_id,COALESCE(b.ordinal,2147483647),j.updated_at DESC,j.id DESC`)).
		WithArgs("alice").
		WillReturnRows(sqlmock.NewRows([]string{"batch_id", "job_id"}).
			AddRow("batch-1", "merge-new").
			AddRow("batch-1", "merge-old"))

	got, err := NewMySQLStore(db).ListBatchSummaryIndex(context.Background(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != "batch-2" || len(got[0].Books) != 1 || got[0].Books[0].Title != "第二通电话" {
		t.Fatalf("unexpected summary index: %#v", got)
	}
	if got[1].Books[0].BookID != "558154" || got[1].Books[0].Platform != "七猫" {
		t.Fatalf("unexpected book summary: %#v", got[1].Books[0])
	}
	if got[1].ProjectCoverJobID != "merge-new" || got[0].ProjectCoverJobID != "" {
		t.Fatalf("unexpected project cover jobs: %#v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
