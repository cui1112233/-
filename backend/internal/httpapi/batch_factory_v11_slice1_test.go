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

func TestNovelFetchIntakeCanJoinTheCurrentBatchOnlyAfterDuplicateConfirmation(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "当前批量", Books: []batchfactoryv11.CreateBookInput{{BookID: "source-1", Title: "原书"}}})
	if err != nil {
		t.Fatal(err)
	}
	intake, err := store.CreateIntake(context.Background(), "alice", batchfactoryv11.NovelFetchIntakeInput{Books: []batchfactoryv11.CreateBookInput{{BookID: "source-1", SourceTaskID: "task-1", Title: "AI1·原书", SourceText: "AI 正文"}}})
	if err != nil {
		t.Fatal(err)
	}
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: store})
	path := "/api/batch-factory/v11/batches/" + batch.ID + "/intakes/" + intake.ID + "/books"
	blocked := signedJSONRequest(t, api, now, "alice", http.MethodPost, path, map[string]any{"allowDuplicate": false})
	if blocked.Code != http.StatusConflict {
		t.Fatalf("unconfirmed status=%d body=%s", blocked.Code, blocked.Body.String())
	}
	joined := signedJSONRequest(t, api, now, "alice", http.MethodPost, path, map[string]any{"allowDuplicate": true})
	if joined.Code != http.StatusOK {
		t.Fatalf("confirmed status=%d body=%s", joined.Code, joined.Body.String())
	}
	got := decodeBody[map[string]batchfactoryv11.Batch](t, joined)["batch"]
	if len(got.Books) != 2 || got.Books[1].BookID != "source-1" || got.Books[1].Title != "AI1·原书" || got.Books[1].SourceText != "AI 正文" {
		t.Fatalf("batch=%+v", got)
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
		{http.MethodPost, "/api/batch-factory/v11/intakes/manual", map[string]any{"platformId": "15", "inputText": "100000000001\t书A"}},
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

func TestManualIntakeCreatesOneBatchAndKeepsManualSourceMetadata(t *testing.T) {
	now := time.Unix(1700000000, 0)
	if books, err := batchfactoryv11.ParseManualBookList(batchfactoryv11.ManualIntakeInput{PlatformID: "15", ParseMode: "smart", ColumnPresetID: "sample_input", InputText: "100000000001\t书A\t精彩理由\t女频\t都市爽文\tS"}); err != nil || len(books) != 1 {
		t.Fatalf("manual parser books=%+v err=%v", books, err)
	}
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: batchfactoryv11.NewMemoryStore()})
	rec := signedJSONRequest(t, api, now, "alice", http.MethodPost, "/api/batch-factory/v11/intakes/manual", map[string]any{
		"title": "晚间批量", "platformId": "15", "platformName": "番茄小说", "parseMode": "smart", "columnPresetId": "sample_input",
		"inputText":                "100000000001\t书A\t精彩理由\t女频\t都市爽文\tS\n100000000002\t书B\t精彩理由\t男频\t都市爽文\tA",
		"sourceTextByBookId":       map[string]string{"100000000001": "第一本完整原文", "100000000002": "第二本完整原文"},
		"contentCaptureCharacters": 4000,
		"contentRangeLines":        5, "scheduledAt": "2026-09-14T02:00:00Z",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	got := decodeBody[map[string]batchfactoryv11.Batch](t, rec)["batch"]
	if got.Title != "晚间批量" || len(got.Books) != 2 {
		t.Fatalf("batch=%+v", got)
	}
	if got.Books[0].SourceMetadata["sourceMode"] != "manual_original" || got.Books[0].SourceMetadata["queueStatus"] != "scheduled_waiting" || got.Books[0].SourceMetadata["platformName"] != "番茄小说" || got.Books[0].SourceMetadata["gender"] != "女频" || got.Books[0].SourceMetadata["tags"] != "都市爽文" || got.Books[0].SourceMetadata["reason"] != "精彩理由" || got.Books[0].SourceMetadata["rating"] != "S" {
		t.Fatalf("metadata=%#v", got.Books[0].SourceMetadata)
	}
	if got.Books[0].SourceText != "第一本完整原文" || got.Books[0].TxtText != "第一本完整原文" || got.Books[1].SourceText != "第二本完整原文" {
		t.Fatalf("fetched source was not persisted: %#v", got.Books)
	}
	if got.Books[0].SourceMetadata["contentCaptureCharacters"] != float64(4000) {
		t.Fatalf("capture metadata=%#v", got.Books[0].SourceMetadata)
	}
}

func TestCaptureMissingBookSourceWritesOnceAndRejectsOverwrite(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "b", Books: []batchfactoryv11.CreateBookInput{{BookID: "2084012035524801698", Title: "白月光回港", Platform: "15", SourceMetadata: map[string]any{"sourceMode": "manual_original"}}}})
	if err != nil {
		t.Fatal(err)
	}
	book := batch.Books[0]
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: store})
	path := "/api/batch-factory/v11/batches/" + batch.ID + "/books/" + book.ID + "/source"
	input := map[string]any{"sourceText": "抓回来的完整正文", "expectedRevision": book.Revision, "sourceMetadata": map[string]any{"sourceMode": "manual_refetched", "captureAttempts": 1}}
	first := signedJSONRequest(t, api, now, "alice", http.MethodPut, path, input)
	if first.Code != http.StatusOK {
		t.Fatalf("capture=%d body=%s", first.Code, first.Body.String())
	}
	captured := decodeBody[map[string]batchfactoryv11.Book](t, first)["book"]
	if captured.SourceText != "抓回来的完整正文" || captured.TxtText != "抓回来的完整正文" || captured.SourceMetadata["sourceMode"] != "manual_refetched" {
		t.Fatalf("captured=%+v", captured)
	}
	second := signedJSONRequest(t, api, now, "alice", http.MethodPut, path, map[string]any{"sourceText": "不应覆盖", "expectedRevision": captured.Revision})
	if second.Code != http.StatusConflict {
		t.Fatalf("overwrite=%d body=%s", second.Code, second.Body.String())
	}
}

func TestBookOverrideDoesNotChangeBatchSettings(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "b", Books: []batchfactoryv11.CreateBookInput{{Title: "book"}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveSettings(context.Background(), "alice", batchfactoryv11.ScopeRef{Kind: batchfactoryv11.ScopeBatch, BatchID: batch.ID}, batchfactoryv11.SettingsUpdate{
		Patch: batchfactoryv11.SettingsPatch{"textModelId": json.RawMessage(`"text-a"`), "aspectRatio": json.RawMessage(`"9:16"`)}, ExpectedRevision: batch.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	book := loaded.Books[0]
	if _, err := store.SaveSettings(context.Background(), "alice", batchfactoryv11.ScopeRef{Kind: batchfactoryv11.ScopeBook, BatchID: loaded.ID, BookID: book.ID}, batchfactoryv11.SettingsUpdate{
		Patch: batchfactoryv11.SettingsPatch{"aspectRatio": json.RawMessage(`"16:9"`)}, ExpectedRevision: book.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	loaded, err = store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(loaded.SettingsState.Patch["textModelId"]); got != `"text-a"` {
		t.Fatalf("batch text model changed: %s", got)
	}
	if got := string(loaded.SettingsState.Patch["aspectRatio"]); got != `"9:16"` {
		t.Fatalf("batch aspect changed: %s", got)
	}
	if got := string(loaded.Books[0].SettingsState.Patch["aspectRatio"]); got != `"16:9"` {
		t.Fatalf("book aspect not saved: %s", got)
	}
	_ = now
}
