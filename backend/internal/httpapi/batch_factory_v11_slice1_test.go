package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
)

func signedJSONRequest(t *testing.T, api http.Handler, now time.Time, username, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(payload))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	SignBridgeRequest(req, username, false, now, "secret")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	return rec
}

func decodeBody[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(rec.Body.Bytes(), &value); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	return value
}

func TestSliceOneCapabilitiesUnlockRequiredSurfaceOnly(t *testing.T) {
	now := time.Unix(1700000000, 0)
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: batchfactoryv11.NewMemoryStore()})
	rec := signedJSONRequest(t, api, now, "alice", http.MethodGet, "/api/batch-factory/v11/capabilities", nil)
	got := decodeBody[map[string]Capability](t, rec)
	for _, key := range []string{"batch.read", "batch.create", "settings.edit", "snapshot.read", "override.edit"} {
		if !got[key].Available {
			t.Fatalf("%s must be available in Slice 1: %+v", key, got)
		}
	}
	for _, key := range []string{"director.run", "hook.review", "production.submit", "merge.run", "publish.121", "publish.yadi"} {
		if got[key].Available {
			t.Fatalf("%s must stay disabled in Slice 1: %+v", key, got)
		}
	}
}

func TestSliceOneCreateListAndGetBatch(t *testing.T) {
	now := time.Unix(1700000000, 0)
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: batchfactoryv11.NewMemoryStore()})
	create := signedJSONRequest(t, api, now, "alice", http.MethodPost, "/api/batch-factory/v11/batches", map[string]any{
		"title": "Alpha", "books": []any{map[string]any{"title": "Book A", "videos": []any{map[string]any{"label": "V1"}}}},
	})
	if create.Code != http.StatusCreated {
		t.Fatalf("create=%d body=%s", create.Code, create.Body.String())
	}
	created := decodeBody[map[string]batchfactoryv11.Batch](t, create)["batch"]
	if created.ID == "" || len(created.Books) != 1 || len(created.Books[0].Videos) != 1 {
		t.Fatalf("batch=%+v", created)
	}

	list := signedJSONRequest(t, api, now, "alice", http.MethodGet, "/api/batch-factory/v11/batches", nil)
	if list.Code != http.StatusOK {
		t.Fatalf("list=%d body=%s", list.Code, list.Body.String())
	}
	listed := decodeBody[map[string][]batchfactoryv11.Batch](t, list)["batches"]
	if len(listed) != 1 || listed[0].ID != created.ID {
		t.Fatalf("listed=%+v", listed)
	}

	get := signedJSONRequest(t, api, now, "alice", http.MethodGet, "/api/batch-factory/v11/batches/"+created.ID, nil)
	if get.Code != http.StatusOK {
		t.Fatalf("get=%d body=%s", get.Code, get.Body.String())
	}
}

func TestSaveVideoOverrideRejectsAnotherOwnersVideo(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, _ := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "b", Books: []batchfactoryv11.CreateBookInput{{Title: "k", Videos: []batchfactoryv11.CreateVideoInput{{Label: "v"}}}}})
	book, video := batch.Books[0], batch.Books[0].Videos[0]
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: store})
	path := "/api/batch-factory/v11/batches/" + batch.ID + "/books/" + book.ID + "/videos/" + video.ID + "/override"
	rec := signedJSONRequest(t, api, now, "bob", http.MethodPut, path, map[string]any{"patch": map[string]any{"quality": "x"}, "expectedRevision": video.Revision})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("got=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestSaveSettingsReturnsConflictForStaleRevisionAndPreservesFalsyValues(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, _ := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "b"})
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: store})
	path := "/api/batch-factory/v11/batches/" + batch.ID + "/settings"
	input := map[string]any{"patch": map[string]any{"enabled": false, "prefix": "", "duration": 0}, "expectedRevision": batch.Revision}
	first := signedJSONRequest(t, api, now, "alice", http.MethodPut, path, input)
	if first.Code != http.StatusOK {
		t.Fatalf("first=%d body=%s", first.Code, first.Body.String())
	}
	result := decodeBody[batchfactoryv11.SettingsResult](t, first)
	if string(result.Patch["enabled"]) != "false" || string(result.Patch["prefix"]) != "\"\"" || string(result.Patch["duration"]) != "0" {
		t.Fatalf("patch=%v", result.Patch)
	}
	stale := signedJSONRequest(t, api, now, "alice", http.MethodPut, path, input)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale=%d body=%s", stale.Code, stale.Body.String())
	}
}

func TestUpdateBookSourceRequiresCurrentRevisionAndNeverLeaksAcrossOwners(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "b", Books: []batchfactoryv11.CreateBookInput{{Title: "book", SourceText: "before"}}})
	if err != nil {
		t.Fatal(err)
	}
	book := batch.Books[0]
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: store})
	path := "/api/batch-factory/v11/batches/" + batch.ID + "/books/" + book.ID + "/source"
	updated := signedJSONRequest(t, api, now, "alice", http.MethodPut, path, map[string]any{"sourceText": "after", "expectedRevision": book.Revision})
	if updated.Code != http.StatusOK {
		t.Fatalf("update=%d body=%s", updated.Code, updated.Body.String())
	}
	stale := signedJSONRequest(t, api, now, "alice", http.MethodPut, path, map[string]any{"sourceText": "again", "expectedRevision": book.Revision})
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale=%d body=%s", stale.Code, stale.Body.String())
	}
	foreign := signedJSONRequest(t, api, now, "bob", http.MethodPut, path, map[string]any{"sourceText": "intrusion", "expectedRevision": book.Revision + 1})
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign=%d body=%s", foreign.Code, foreign.Body.String())
	}
}

func TestCreateBatchFromOtherOwnersIntakeReturnsNotFound(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	intake, _ := store.CreateIntake(context.Background(), "alice", batchfactoryv11.NovelFetchIntakeInput{Books: []batchfactoryv11.CreateBookInput{{Title: "A"}}})
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: store})
	rec := signedJSONRequest(t, api, now, "bob", http.MethodPost, "/api/batch-factory/v11/intakes/"+intake.ID+"/batches", map[string]any{})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("got=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestSliceOneRequiredHTTPRoutesAreRegistered(t *testing.T) {
	now := time.Unix(1700000000, 0)
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: batchfactoryv11.NewMemoryStore()})
	cases := []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodGet, "/api/batch-factory/v11/capabilities", nil},
		{http.MethodPost, "/api/batch-factory/v11/intakes/novel-fetch", map[string]any{"books": []any{}}},
		{http.MethodGet, "/api/batch-factory/v11/intakes/missing", nil},
		{http.MethodPost, "/api/batch-factory/v11/intakes/missing/batches", map[string]any{}},
		{http.MethodGet, "/api/batch-factory/v11/batches", nil},
		{http.MethodPost, "/api/batch-factory/v11/batches", map[string]any{"title": "x"}},
		{http.MethodGet, "/api/batch-factory/v11/batches/missing", nil},
		{http.MethodPut, "/api/batch-factory/v11/batches/missing/settings", map[string]any{"patch": map[string]any{}, "expectedRevision": 1}},
		{http.MethodPut, "/api/batch-factory/v11/batches/missing/books/missing/override", map[string]any{"patch": map[string]any{}, "expectedRevision": 1}},
		{http.MethodPut, "/api/batch-factory/v11/batches/missing/books/missing/videos/missing/override", map[string]any{"patch": map[string]any{}, "expectedRevision": 1}},
		{http.MethodPost, "/api/batch-factory/v11/batches/missing/change-impact", map[string]any{"patch": map[string]any{}}},
		{http.MethodGet, "/api/batch-factory/v11/config-versions", nil},
		{http.MethodGet, "/api/batch-factory/v11/prompts", nil},
		{http.MethodPost, "/api/batch-factory/v11/prompts", map[string]any{"name": "p", "kind": "constraint", "content": "c"}},
		{http.MethodGet, "/api/batch-factory/v11/drafts?key=k&kind=constraint&scope=batch", nil},
		{http.MethodPut, "/api/batch-factory/v11/drafts", map[string]any{"key": "k", "kind": "constraint", "scope": "batch", "content": "c"}},
	}
	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := signedJSONRequest(t, api, now, "alice", tc.method, tc.path, tc.body)
			if rec.Header().Get("Content-Type") != "application/json; charset=utf-8" {
				t.Fatalf("route not registered or wrong surface: status=%d content-type=%q body=%s", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
			}
		})
	}
}
