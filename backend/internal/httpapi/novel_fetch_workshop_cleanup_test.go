package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"qiantie/backend/internal/novelfetchworkshop"
)

func TestNovelFetchWorkshopSignedCleanupLifecycle(t *testing.T) {
	released := time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC)
	secret := "test-secret"
	store := novelfetchworkshop.NewMemoryStore()
	ctx := context.Background()

	if err := store.PutDocument(ctx, "tester", novelfetchworkshop.Document{
		BookID: "book-1",
		Meta:   map[string]any{"bookName": "测试小说", "status": "done"},
		BodyRefs: map[string]novelfetchworkshop.BodyRef{
			"ai3": {VersionID: "ai3", State: "ready"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutBody(ctx, "tester", novelfetchworkshop.BodyRecord{
		BookID:  "book-1",
		BodyRef: novelfetchworkshop.BodyRef{VersionID: "ai3", State: "ready"},
		Content: "AI3 正文",
	}); err != nil {
		t.Fatal(err)
	}

	handler := NewRouter(RouterOptions{
		BridgeSecret:    secret,
		Now:             func() time.Time { return released },
		NovelFetchStore: store,
	})

	release := doNovelFetchRequest(t, handler, http.MethodPost, "/api/novel-fetch-workshop/tasks/book-1/bodies/ai3/release", map[string]any{
		"retentionDays": 1,
	}, released, secret)
	if release.Code != http.StatusOK {
		t.Fatalf("release status=%d body=%s", release.Code, release.Body.String())
	}
	var ref novelfetchworkshop.BodyRef
	if err := json.Unmarshal(release.Body.Bytes(), &ref); err != nil {
		t.Fatal(err)
	}
	if ref.State != "releasable" || ref.ReleasableAt != released.Format(time.RFC3339Nano) {
		t.Fatalf("release ref=%+v", ref)
	}

	tooEarly := doNovelFetchRequest(t, handler, http.MethodPost, "/api/novel-fetch-workshop/bodies/cleanup", map[string]any{
		"reason": "expired",
		"limit":  10,
	}, released, secret)
	if tooEarly.Code != http.StatusOK {
		t.Fatalf("too-early cleanup status=%d body=%s", tooEarly.Code, tooEarly.Body.String())
	}
	var earlyResult novelfetchworkshop.BodyCleanupResult
	if err := json.Unmarshal(tooEarly.Body.Bytes(), &earlyResult); err != nil {
		t.Fatal(err)
	}
	if earlyResult.Deleted != 0 {
		t.Fatalf("deleted too early: %+v", earlyResult)
	}

	expiredAt := released.Add(24 * time.Hour)
	expiredHandler := NewRouter(RouterOptions{
		BridgeSecret:    secret,
		Now:             func() time.Time { return expiredAt },
		NovelFetchStore: store,
	})
	cleanup := doNovelFetchRequest(t, expiredHandler, http.MethodPost, "/api/novel-fetch-workshop/bodies/cleanup", map[string]any{
		"reason": "expired",
		"limit":  10,
	}, expiredAt, secret)
	if cleanup.Code != http.StatusOK {
		t.Fatalf("cleanup status=%d body=%s", cleanup.Code, cleanup.Body.String())
	}
	var result novelfetchworkshop.BodyCleanupResult
	if err := json.Unmarshal(cleanup.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Deleted != 1 || len(result.Results) != 1 || result.Results[0].BookID != "book-1" || result.Results[0].VersionID != "ai3" {
		t.Fatalf("cleanup result=%+v", result)
	}

	history := doNovelFetchRequest(t, expiredHandler, http.MethodGet, "/api/novel-fetch-workshop/tasks/book-1", nil, expiredAt, secret)
	if history.Code != http.StatusOK {
		t.Fatalf("history status=%d body=%s", history.Code, history.Body.String())
	}
	body := doNovelFetchRequest(t, expiredHandler, http.MethodGet, "/api/novel-fetch-workshop/tasks/book-1/bodies/ai3", nil, expiredAt, secret)
	if body.Code != http.StatusNotFound {
		t.Fatalf("body status=%d body=%s", body.Code, body.Body.String())
	}
}
