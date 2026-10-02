package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
)

type runtimeIndexStore struct {
	*batchfactoryv11.MemoryStore
	runtimeCalls int
}

func (s *runtimeIndexStore) GetBatchRuntimeIndex(_ context.Context, owner, batchID string) (batchfactoryv11.Batch, error) {
	s.runtimeCalls++
	return batchfactoryv11.Batch{ID: batchID, Revision: 9, Books: []batchfactoryv11.Book{{ID: "book-1", BatchID: batchID}}}, nil
}

func TestBatchRuntimeIndexRouteUsesLightweightReader(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := &runtimeIndexStore{MemoryStore: batchfactoryv11.NewMemoryStore()}
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: store})
	req := httptest.NewRequest(http.MethodGet, "/api/batch-factory/v11/batches/batch-1/runtime-index", nil)
	SignBridgeRequest(req, "alice", false, now, "secret")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if store.runtimeCalls != 1 {
		t.Fatalf("runtime index calls = %d, want 1", store.runtimeCalls)
	}
}
