package novelfetchworkshop

import (
	"context"
	"testing"
)

func TestDeletingHistoryDocumentKeepsBodyStoreData(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	if err := store.PutDocument(ctx, "alice", Document{BookID: "123", Meta: map[string]any{"bookName": "测试小说"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutBody(ctx, "alice", BodyRecord{
		BookID:  "123",
		BodyRef: BodyRef{VersionID: "ai3", State: "ready"},
		Content: "AI3正文仍然保留",
	}); err != nil {
		t.Fatal(err)
	}

	result, err := store.DeleteDocuments(ctx, "alice", []string{"123"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Deleted != 1 {
		t.Fatalf("deleted=%d", result.Deleted)
	}
	if _, err := store.GetDocument(ctx, "alice", "123"); err != ErrNotFound {
		t.Fatalf("history err=%v", err)
	}
	body, err := store.GetBody(ctx, "alice", "123", "ai3")
	if err != nil {
		t.Fatalf("body should remain after history deletion: %v", err)
	}
	if body.Content != "AI3正文仍然保留" {
		t.Fatalf("body=%q", body.Content)
	}
}
