package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"qiantie/backend/internal/novelfetchworkshop"
)

func TestNovelFetchWorkshopSignedBodyStorageStatus(t *testing.T) {
	now := time.Date(2026, 9, 2, 17, 0, 0, 0, time.UTC)
	secret := "test-secret"
	store := novelfetchworkshop.NewMemoryStore()
	if _, err := store.PutBody(context.Background(), "tester", novelfetchworkshop.BodyRecord{
		BookID: "123",
		BodyRef: novelfetchworkshop.BodyRef{VersionID: "ai3", State: "ready"},
		Content: "AI3容量统计正文",
	}); err != nil {
		t.Fatal(err)
	}

	handler := NewRouter(RouterOptions{
		BridgeSecret:    secret,
		Now:             func() time.Time { return now },
		NovelFetchStore: store,
	})
	response := doNovelFetchRequest(t, handler, http.MethodGet, "/api/novel-fetch-workshop/bodies/status", nil, now, secret)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var status novelfetchworkshop.BodyStorageStatus
	if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.BodyCount != 1 || status.StorageBytes <= 0 || status.CharCount <= 0 {
		t.Fatalf("status=%+v", status)
	}
}
