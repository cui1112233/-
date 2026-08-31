package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
)

func TestSaveBatchConfigVersionRejectsUnknownID(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, _ := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "b"})
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: store})
	path := "/api/batch-factory/v11/batches/" + batch.ID + "/settings"
	rec := signedJSONRequest(t, api, now, "alice", http.MethodPut, path, map[string]any{
		"patch": map[string]any{"versionConfigId": "missing-v1"}, "expectedRevision": batch.Revision,
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("got=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestSaveBatchConfigVersionStaleRevisionReturnsConflict(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, _ := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "b"})
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: store})
	path := "/api/batch-factory/v11/batches/" + batch.ID + "/settings"
	input := map[string]any{"patch": map[string]any{"versionConfigId": "system-default-v1"}, "expectedRevision": batch.Revision}
	first := signedJSONRequest(t, api, now, "alice", http.MethodPut, path, input)
	if first.Code != http.StatusOK {
		t.Fatalf("first=%d body=%s", first.Code, first.Body.String())
	}
	stale := signedJSONRequest(t, api, now, "alice", http.MethodPut, path, input)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale=%d body=%s", stale.Code, stale.Body.String())
	}
}

func TestBookConfigVersionWriteIsRejected(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, _ := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "b", Books: []batchfactoryv11.CreateBookInput{{Title: "book"}}})
	book := batch.Books[0]
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: store})
	path := "/api/batch-factory/v11/batches/" + batch.ID + "/books/" + book.ID + "/override"
	rec := signedJSONRequest(t, api, now, "alice", http.MethodPut, path, map[string]any{
		"patch": map[string]any{"versionConfigId": "system-default-v1"}, "expectedRevision": book.Revision,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("got=%d body=%s", rec.Code, rec.Body.String())
	}
}
