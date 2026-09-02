package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"qiantie/backend/internal/novelfetchworkshop"
)

func TestS2RouterOptionsCanHostLocalExecutorsWithoutDroppingNovelFetch(t *testing.T) {
	router := NewRouter(RouterOptions{
		BridgeSecret:    "test-bridge-secret",
		NovelFetchStore: novelfetchworkshop.NewMemoryStore(),
		LocalExecutors:  nil,
	})

	novelReq := httptest.NewRequest(http.MethodGet, "/api/novel-fetch-workshop/tasks", nil)
	novelRec := httptest.NewRecorder()
	router.ServeHTTP(novelRec, novelReq)
	if novelRec.Code == http.StatusNotFound {
		t.Fatal("novel fetch Body/Document routes must remain registered after executor integration")
	}
	if novelRec.Code != http.StatusUnauthorized {
		t.Fatalf("novel route status=%d body=%s", novelRec.Code, novelRec.Body.String())
	}
}
