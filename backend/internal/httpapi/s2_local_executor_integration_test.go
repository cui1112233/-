package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/localexecutor"
	"qiantie/backend/internal/novelfetchworkshop"
)

func TestS2RouterKeepsNovelFetchAndLocalExecutorOnOneBackend(t *testing.T) {
	now := func() time.Time { return time.Date(2026, 9, 3, 9, 0, 0, 0, time.UTC) }
	executors := localexecutor.NewService(localexecutor.NewMemoryStore(), now)
	router := NewRouter(RouterOptions{
		BridgeSecret:    "test-bridge-secret",
		Now:             now,
		NovelFetchStore: novelfetchworkshop.NewMemoryStore(),
		LocalExecutors:  executors,
	})

	pairReq := httptest.NewRequest(http.MethodPost, "/api/local-executor/v1/pair", strings.NewReader(`{"platform":"doubao","code":"NOT-A-REAL-CODE","deviceName":"S2 Test","os":"linux","version":"1.0.0"}`))
	pairReq.Header.Set("Content-Type", "application/json")
	pairRec := httptest.NewRecorder()
	router.ServeHTTP(pairRec, pairReq)
	if pairRec.Code == http.StatusNotFound {
		t.Fatal("local executor pair route must be registered on the same S2 backend")
	}
	if pairRec.Code != http.StatusConflict {
		t.Fatalf("pair status=%d body=%s", pairRec.Code, pairRec.Body.String())
	}

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
