package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"qiantie/backend/internal/novelfetchworkshop"
)

func TestNovelFetchWorkshopBodyBridgeRoundTrip(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	secret := "test-secret"
	store := novelfetchworkshop.NewMemoryStore()
	handler := NewRouter(RouterOptions{
		BridgeSecret:    secret,
		Now:             func() time.Time { return now },
		NovelFetchStore: store,
	})

	put := doNovelFetchRequest(t, handler, http.MethodPut, "/api/novel-fetch-workshop/tasks/book-1/bodies/ai3", map[string]any{
		"content": "AI3中文正文",
		"state":   "ready",
	}, now, secret)
	if put.Code != http.StatusOK {
		t.Fatalf("put status=%d body=%s", put.Code, put.Body.String())
	}
	var putRef novelfetchworkshop.BodyRef
	if err := json.Unmarshal(put.Body.Bytes(), &putRef); err != nil {
		t.Fatal(err)
	}
	if putRef.VersionID != "ai3" || putRef.Revision != 1 || putRef.ContentHash == "" {
		t.Fatalf("put ref=%+v", putRef)
	}

	get := doNovelFetchRequest(t, handler, http.MethodGet, "/api/novel-fetch-workshop/tasks/book-1/bodies/ai3", nil, now, secret)
	if get.Code != http.StatusOK {
		t.Fatalf("get status=%d body=%s", get.Code, get.Body.String())
	}
	var body novelfetchworkshop.BodyRecord
	if err := json.Unmarshal(get.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.BookID != "book-1" || body.VersionID != "ai3" || body.Content != "AI3中文正文" {
		t.Fatalf("body=%+v", body)
	}

	list := doNovelFetchRequest(t, handler, http.MethodGet, "/api/novel-fetch-workshop/tasks/book-1/bodies", nil, now, secret)
	if list.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", list.Code, list.Body.String())
	}
	var listed struct {
		Bodies []map[string]any `json:"bodies"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Bodies) != 1 || listed.Bodies[0]["versionId"] != "ai3" {
		t.Fatalf("bodies=%#v", listed.Bodies)
	}
	if _, exists := listed.Bodies[0]["content"]; exists {
		t.Fatalf("list leaked body content: %#v", listed.Bodies[0])
	}

	deleted := doNovelFetchRequest(t, handler, http.MethodDelete, "/api/novel-fetch-workshop/tasks/book-1/bodies/ai3", nil, now, secret)
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete status=%d body=%s", deleted.Code, deleted.Body.String())
	}
	var deleteResult struct {
		Deleted bool `json:"deleted"`
	}
	if err := json.Unmarshal(deleted.Body.Bytes(), &deleteResult); err != nil {
		t.Fatal(err)
	}
	if !deleteResult.Deleted {
		t.Fatal("expected deleted=true")
	}

	missing := doNovelFetchRequest(t, handler, http.MethodGet, "/api/novel-fetch-workshop/tasks/book-1/bodies/ai3", nil, now, secret)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing status=%d body=%s", missing.Code, missing.Body.String())
	}
}

func TestNovelFetchWorkshopBodyBridgeRejectsInvalidVersionID(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	secret := "test-secret"
	store := novelfetchworkshop.NewMemoryStore()
	handler := NewRouter(RouterOptions{
		BridgeSecret:    secret,
		Now:             func() time.Time { return now },
		NovelFetchStore: store,
	})

	response := doNovelFetchRequest(t, handler, http.MethodPut, "/api/novel-fetch-workshop/tasks/book-1/bodies/bad%20version", map[string]any{
		"content": "正文",
	}, now, secret)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
