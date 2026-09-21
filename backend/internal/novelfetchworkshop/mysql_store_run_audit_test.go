package novelfetchworkshop

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestMySQLStoreRunAuditPersistsOnlyAuditFields(t *testing.T) {
	_, mock, store := newBodySQLMock(t)
	finished := "2026-09-21T01:02:03Z"
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO novel_fetch_workshop_runs(run_id,owner_username,book_id,stage,status,attempts,text_model_id,model_id,model_display_name,request_id,error_message,started_at,finished_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE book_id=VALUES(book_id),stage=VALUES(stage),status=VALUES(status),attempts=VALUES(attempts),text_model_id=VALUES(text_model_id),model_id=VALUES(model_id),model_display_name=VALUES(model_display_name),request_id=VALUES(request_id),error_message=VALUES(error_message),started_at=VALUES(started_at),finished_at=VALUES(finished_at),updated_at=CURRENT_TIMESTAMP(6)`)).
		WithArgs("run-1", "alice", "book-1", "rewrite", "succeeded", 1, "gemini-3", "gemini-3", "Gemini 3", nil, nil, nil, time.Date(2026, 9, 21, 1, 2, 3, 0, time.UTC), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	if err := store.PutRun(context.Background(), "alice", RunRecord{RunID: "run-1", BookID: "book-1", Stage: "rewrite", Status: "succeeded", Attempts: 1, TextModelID: "gemini-3", ModelID: "gemini-3", ModelDisplayName: "Gemini 3", FinishedAt: finished}); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestMySQLStoreListsRunAuditByBook(t *testing.T) {
	_, mock, store := newBodySQLMock(t)
	updated := time.Date(2026, 9, 21, 1, 2, 4, 0, time.UTC)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT run_id,book_id,stage,status,attempts,text_model_id,model_id,model_display_name,COALESCE(request_id,''),COALESCE(error_message,''),started_at,finished_at,updated_at FROM novel_fetch_workshop_runs WHERE owner_username=? AND book_id=? ORDER BY updated_at DESC, run_id ASC`)).
		WithArgs("alice", "book-1").
		WillReturnRows(sqlmock.NewRows([]string{"run_id", "book_id", "stage", "status", "attempts", "text_model_id", "model_id", "model_display_name", "request_id", "error_message", "started_at", "finished_at", "updated_at"}).AddRow("run-1", "book-1", "rewrite", "succeeded", 1, "gemini-3", "gemini-3", "Gemini 3", "", "", nil, updated, updated))
	runs, err := store.ListRuns(context.Background(), "alice", "book-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].ModelID != "gemini-3" || runs[0].BookID != "book-1" {
		t.Fatalf("runs=%+v", runs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
