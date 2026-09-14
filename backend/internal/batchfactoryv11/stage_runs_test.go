package batchfactoryv11

import (
	"context"
	"testing"
	"time"
)

func TestLatestFailedBookStageRunStaysWithinBook(t *testing.T) {
	store := NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", CreateBatchInput{Title: "batch", Books: []CreateBookInput{{Title: "first"}, {Title: "second"}}})
	if err != nil {
		t.Fatal(err)
	}
	first, second := batch.Books[0], batch.Books[1]
	_, err = store.CreateBookStageRun(context.Background(), BookStageRun{Owner: "alice", BatchID: batch.ID, BookID: first.ID, Stage: BookStageImage, Status: ProductionFailed, Attempt: 1, ErrorMessage: "image failed", UpdatedAt: time.Unix(10, 0)})
	if err != nil {
		t.Fatal(err)
	}
	secondFailure, err := store.CreateBookStageRun(context.Background(), BookStageRun{Owner: "alice", BatchID: batch.ID, BookID: second.ID, Stage: BookStageVideo, Status: ProductionFailed, Attempt: 1, ErrorMessage: "video failed", UpdatedAt: time.Unix(20, 0)})
	if err != nil {
		t.Fatal(err)
	}
	all, err := store.ListBookStageRuns(context.Background(), "alice", batch.ID, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].BookID != first.ID || all[0].ID == secondFailure.ID {
		t.Fatalf("runs=%+v second=%+v", all, secondFailure)
	}
	latest := LatestFailedBookStageRun(all)
	if latest == nil || latest.Stage != BookStageImage {
		t.Fatalf("latest=%+v", latest)
	}
}
