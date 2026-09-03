package novelfetchworkshop

import (
	"context"
	"testing"
)

func TestMemoryStoreDocumentPreservesBodyRefs(t *testing.T) {
	store := NewMemoryStore()
	document := Document{
		BookID: "123",
		Meta:   map[string]any{"bookName": "test"},
		BodyRefs: map[string]BodyRef{
			"original": {VersionID: "original", Revision: 2, ContentHash: "hash", CharCount: 100, State: "ready"},
		},
	}
	if err := store.PutDocument(context.Background(), "alice", document); err != nil {
		t.Fatal(err)
	}
	got, err := store.GetDocument(context.Background(), "alice", "123")
	if err != nil {
		t.Fatal(err)
	}
	ref, ok := got.BodyRefs["original"]
	if !ok || ref.VersionID != "original" || ref.Revision != 2 || ref.CharCount != 100 {
		t.Fatalf("bodyRefs=%+v", got.BodyRefs)
	}
}
