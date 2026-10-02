package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
)

type recoveryIndexStore struct {
	*batchfactoryv11.MemoryStore
	recoveryCalls int
}

func (s *recoveryIndexStore) ListBatchRecoveryIndex(_ context.Context, owner string) ([]batchfactoryv11.Batch, error) {
	s.recoveryCalls++
	return []batchfactoryv11.Batch{{ID: "batch-1", Books: []batchfactoryv11.Book{{ID: "book-1"}}}}, nil
}

func TestBatchRecoveryIndexRouteUsesLightweightLister(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := &recoveryIndexStore{MemoryStore: batchfactoryv11.NewMemoryStore()}
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: store})
	req := httptest.NewRequest(http.MethodGet, "/api/batch-factory/v11/batches/recovery-index", nil)
	SignBridgeRequest(req, "alice", false, now, "secret")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if store.recoveryCalls != 1 {
		t.Fatalf("recovery index calls = %d, want 1", store.recoveryCalls)
	}
}
