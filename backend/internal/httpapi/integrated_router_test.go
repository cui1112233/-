package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"qiantie/backend/internal/localexecutor"
	"qiantie/backend/internal/novelfetchworkshop"
)

func TestIntegratedRouterKeepsNovelFetchAndLocalExecutorRoutes(t *testing.T) {
	now := time.Date(2026, 9, 2, 2, 0, 0, 0, time.UTC)
	nowFn := func() time.Time { return now }
	handler := NewRouter(RouterOptions{
		BridgeSecret:    "secret",
		Now:             nowFn,
		NovelFetchStore: novelfetchworkshop.NewMemoryStore(),
		LocalExecutors:  localexecutor.NewService(localexecutor.NewMemoryStore(), nowFn),
	})

	pairingReq := jsonRequest(t, http.MethodPost, "/api/shuihuo-production/local-executors/pairings", map[string]any{"platform": "doubao"})
	signNewlineBridgeRequest(pairingReq, "alice", false, now, "secret")
	pairingRec := httptest.NewRecorder()
	handler.ServeHTTP(pairingRec, pairingReq)
	if pairingRec.Code != http.StatusCreated {
		t.Fatalf("pairing route missing or broken: status=%d body=%s", pairingRec.Code, pairingRec.Body.String())
	}

	novelReq := httptest.NewRequest(http.MethodGet, "/api/novel-fetch-workshop/tasks", nil)
	signNovelFetchRequest(novelReq, "alice", false, now, "secret")
	novelRec := httptest.NewRecorder()
	handler.ServeHTTP(novelRec, novelReq)
	if novelRec.Code != http.StatusOK {
		t.Fatalf("novel fetch route missing or broken: status=%d body=%s", novelRec.Code, novelRec.Body.String())
	}
}
