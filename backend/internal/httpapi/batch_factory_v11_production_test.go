package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
)

type productionHTTPAdapter struct{ calls int }

func (a *productionHTTPAdapter) Submit(context.Context, batchfactoryv11.FrozenVideoModel, batchfactoryv11.FinalPrompt) (batchfactoryv11.ProviderTaskRef, error) {
	a.calls++
	return batchfactoryv11.ProviderTaskRef{ProviderTaskID: "provider-http-1", State: batchfactoryv11.ProductionSucceeded, MediaURL: "https://media.example/generated.mp4"}, nil
}

type mergeHTTPAdapter struct{ calls int }

func (a *mergeHTTPAdapter) Submit(_ context.Context, _ string, sources []batchfactoryv11.MergeMedia, _ batchfactoryv11.MergeOptions) (batchfactoryv11.MergeJob, error) {
	a.calls++
	if len(sources) != 1 || sources[0].URL == "" {
		return batchfactoryv11.MergeJob{}, batchfactoryv11.ErrInvalid
	}
	return batchfactoryv11.MergeJob{Status: batchfactoryv11.MergeSucceeded, OutputURL: "https://media.example/merged.mp4"}, nil
}

func TestSliceFourProductionRoutesSubmitAndReadDurableStatus(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "b", Books: []batchfactoryv11.CreateBookInput{{Title: "k", SourceText: "林晚推门进入客厅。"}}})
	if err != nil {
		t.Fatal(err)
	}
	director := &batchfactoryv11.DirectorService{Store: store, Provider: &directorHTTPProvider{output: directorHTTPJSON}}
	if _, err := director.RunDirector(context.Background(), "alice", batch.ID, batch.Books[0].ID); err != nil {
		t.Fatal(err)
	}
	adapter := &productionHTTPAdapter{}
	production := &batchfactoryv11.ProductionService{Store: store, Compiler: &batchfactoryv11.PromptCompilerService{Store: store}, Adapter: adapter, Enabled: true, Model: batchfactoryv11.FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 4, Store: store, Director: director, Compiler: &batchfactoryv11.PromptCompilerService{Store: store}, Production: production})
	base := "/api/batch-factory/v11/batches/" + batch.ID + "/books/" + batch.Books[0].ID
	rec := signedJSONRequest(t, api, now, "alice", http.MethodPost, base+"/production", map[string]any{"requestId": "submit-http-1"})
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), "provider-http-1") || adapter.calls != 1 {
		t.Fatalf("submit status=%d body=%s calls=%d", rec.Code, rec.Body.String(), adapter.calls)
	}
	status := signedJSONRequest(t, api, now, "alice", http.MethodGet, "/api/batch-factory/v11/batches/"+batch.ID+"/status", nil)
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), "succeeded") {
		t.Fatalf("status=%d body=%s", status.Code, status.Body.String())
	}
	batchRun := signedJSONRequest(t, api, now, "alice", http.MethodPost, "/api/batch-factory/v11/batches/"+batch.ID+"/production", map[string]any{"requestId": "submit-batch-1"})
	if batchRun.Code != http.StatusCreated || !strings.Contains(batchRun.Body.String(), batch.ID) {
		t.Fatalf("batch status=%d body=%s", batchRun.Code, batchRun.Body.String())
	}
}

func TestSliceFourBatchProductionRunsOnlySelectedBooks(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "b", Books: []batchfactoryv11.CreateBookInput{
		{Title: "k1", SourceText: "第一本。"},
		{Title: "k2", SourceText: "第二本。"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	for _, book := range batch.Books {
		director := &batchfactoryv11.DirectorService{Store: store, Provider: &directorHTTPProvider{output: directorHTTPJSON}}
		if _, err := director.RunDirector(context.Background(), "alice", batch.ID, book.ID); err != nil {
			t.Fatal(err)
		}
	}
	adapter := &productionHTTPAdapter{}
	production := &batchfactoryv11.ProductionService{Store: store, Compiler: &batchfactoryv11.PromptCompilerService{Store: store}, Adapter: adapter, Enabled: true, Model: batchfactoryv11.FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 4, Store: store, Production: production})
	path := "/api/batch-factory/v11/batches/" + batch.ID + "/production"
	rec := signedJSONRequest(t, api, now, "alice", http.MethodPost, path, map[string]any{"requestId": "selected-production", "bookIds": []string{batch.Books[1].ID}})
	if rec.Code != http.StatusCreated || adapter.calls != 1 {
		t.Fatalf("status=%d body=%s calls=%d", rec.Code, rec.Body.String(), adapter.calls)
	}
	status := decodeBody[batchfactoryv11.BatchStatus](t, rec)
	if len(status.Jobs) != 1 || status.Jobs[0].BookID != batch.Books[1].ID {
		t.Fatalf("status=%+v", status)
	}
}

func TestSliceThreeDoesNotExposeProductionMutation(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 3, Store: store})
	rec := signedJSONRequest(t, api, now, "alice", http.MethodPost, "/api/batch-factory/v11/batches/x/production", map[string]any{"requestId": "nope"})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestSliceFiveMergeRouteIsIdempotentAndOwnerScoped(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", batchfactoryv11.CreateBatchInput{Title: "b", Books: []batchfactoryv11.CreateBookInput{{Title: "k", SourceText: "林晚推门进入客厅。"}}})
	if err != nil {
		t.Fatal(err)
	}
	director := &batchfactoryv11.DirectorService{Store: store, Provider: &directorHTTPProvider{output: directorHTTPJSON}}
	if _, err := director.RunDirector(context.Background(), "alice", batch.ID, batch.Books[0].ID); err != nil {
		t.Fatal(err)
	}
	production := &batchfactoryv11.ProductionService{Store: store, Compiler: &batchfactoryv11.PromptCompilerService{Store: store}, Adapter: &productionHTTPAdapter{}, Enabled: true, Model: batchfactoryv11.FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	if _, err := production.SubmitBookProduction(context.Background(), "alice", batch.ID, batch.Books[0].ID, "production-for-merge"); err != nil {
		t.Fatal(err)
	}
	mergeAdapter := &mergeHTTPAdapter{}
	merge := &batchfactoryv11.MergeService{Store: store, Adapter: mergeAdapter, Enabled: true}
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 5, Store: store, Director: director, Compiler: &batchfactoryv11.PromptCompilerService{Store: store}, Production: production, Merge: merge})
	path := "/api/batch-factory/v11/batches/" + batch.ID + "/merge"
	first := signedJSONRequest(t, api, now, "alice", http.MethodPost, path, map[string]any{"requestId": "merge-http-1", "timingMode": "speed", "speed": 1.5})
	second := signedJSONRequest(t, api, now, "alice", http.MethodPost, path, map[string]any{"requestId": "merge-http-1", "timingMode": "speed", "speed": 1.5})
	if first.Code != http.StatusCreated || second.Code != http.StatusCreated || !strings.Contains(first.Body.String(), "merged.mp4") || first.Body.String() != second.Body.String() || mergeAdapter.calls != 1 {
		t.Fatalf("first=%d %s second=%d %s calls=%d", first.Code, first.Body.String(), second.Code, second.Body.String(), mergeAdapter.calls)
	}
	status := signedJSONRequest(t, api, now, "alice", http.MethodGet, "/api/batch-factory/v11/batches/"+batch.ID+"/merge-status", nil)
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), "merged.mp4") {
		t.Fatalf("status=%d body=%s", status.Code, status.Body.String())
	}
	other := signedJSONRequest(t, api, now, "bob", http.MethodGet, "/api/batch-factory/v11/batches/"+batch.ID+"/merge-status", nil)
	if other.Code != http.StatusNotFound {
		t.Fatalf("cross-owner status=%d body=%s", other.Code, other.Body.String())
	}
}
