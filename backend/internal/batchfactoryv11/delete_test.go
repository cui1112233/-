package batchfactoryv11

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestDeleteBookKeepsSiblingBook(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	batch, err := store.CreateBatch(ctx, "alice", CreateBatchInput{Title: "batch", Books: []CreateBookInput{{Title: "first"}, {Title: "second"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteBook(ctx, "alice", batch.ID, batch.Books[0].ID); err != nil {
		t.Fatal(err)
	}
	remaining, err := store.GetBatch(ctx, "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining.Books) != 1 || remaining.Books[0].ID != batch.Books[1].ID {
		t.Fatalf("remaining books = %#v", remaining.Books)
	}
}

func TestDeleteBatchRejectsOtherOwner(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	batch, err := store.CreateBatch(ctx, "alice", CreateBatchInput{Title: "batch"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteBatch(ctx, "bob", batch.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	if _, err := store.GetBatch(ctx, "alice", batch.ID); err != nil {
		t.Fatalf("alice batch unexpectedly changed: %v", err)
	}
}

// TestDeleteBookStmtsPlaceholderCountMatchesArgs guards against the bug where
// the drafts DELETE had 2 placeholders but was handed 3 arguments, which made
// every book/batch deletion fail with a 500 internal error.
func TestDeleteBookStmtsPlaceholderCountMatchesArgs(t *testing.T) {
	for _, stmt := range deleteBookStmts {
		placeholders := strings.Count(stmt.query, "?")
		args := stmt.args("owner", "batch", "book")
		if placeholders != len(args) {
			t.Errorf("delete statement has %d placeholders but %d args:\n%s", placeholders, len(args), stmt.query)
		}
	}
}
