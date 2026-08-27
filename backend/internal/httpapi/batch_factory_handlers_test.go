package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"qiantie/backend/internal/store"
)

func TestBatchFactoryBridgeRequiresDatabaseInsteadOfFallingThrough(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	path := "/api/batch-factory-data/batches"
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodGet, path, "batch-user", false))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET batch bridge status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}
