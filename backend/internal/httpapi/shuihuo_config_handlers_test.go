package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"qiantie/backend/internal/store"
)

func TestShuihuoProductionConfigRequiresConfiguredDatabase(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodGet, "/api/shuihuo-production/config", "producer", false))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET production config status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestShuihuoAssetTypesRequiresConfiguredDatabase(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodGet, "/api/shuihuo-production/asset-types", "producer", false))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET asset types status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestShuihuoAssetCandidateApplyRequiresConfiguredDatabase(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/1/assets/candidates/apply", "producer", false))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("POST asset candidate apply status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestShuihuoImagePromptCandidatesRequireConfiguredDatabase(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/1/prompt-candidates/image", "producer", false))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("POST image prompt candidates status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestShuihuoProjectFilesRequiresConfiguredDatabase(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodGet, "/api/shuihuo-production/projects/1/files", "producer", false))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET project files status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}
