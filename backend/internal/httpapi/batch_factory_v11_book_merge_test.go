package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
)

type bookMergeProductionAdapter struct{}

func (a *bookMergeProductionAdapter) Submit(_ context.Context, _ batchfactoryv11.FrozenVideoModel, prompt batchfactoryv11.FinalPrompt) (batchfactoryv11.ProviderTaskRef, error) {
	if strings.TrimSpace(prompt.ShotID) == "" {
		return batchfactoryv11.ProviderTaskRef{}, fmt.Errorf("shot id is required")
	}
	return batchfactoryv11.ProviderTaskRef{
		ProviderTaskID: "production-" + prompt.ShotID,
		State:          batchfactoryv11.ProductionSucceeded,
		MediaURL:       "https://media.example/" + prompt.ShotID + ".mp4",
	}, nil
}

type bookMergeRouteAdapter struct {
	calls []batchfactoryv11.MergeOptions
}

func (a *bookMergeRouteAdapter) Submit(_ context.Context, _ string, _ []batchfactoryv11.MergeMedia, options batchfactoryv11.MergeOptions) (batchfactoryv11.MergeJob, error) {
	a.calls = append(a.calls, options)
	if len(a.calls) == 1 {
		return batchfactoryv11.MergeJob{Status: batchfactoryv11.MergeSucceeded, OutputURL: "https://media.example/video.mp4"}, nil
	}
	return batchfactoryv11.MergeJob{Status: batchfactoryv11.MergeSucceeded, OutputURL: "https://media.example/book.mp4"}, nil
}

func TestSliceFiveExposesPerBookMergeAndAudioTimingStatus(t *testing.T) {
	now := time.Unix(1700000000, 0)
	ctx := context.Background()
	store := batchfactoryv11.NewMemoryStore()
	batch, err := store.CreateBatch(ctx, "alice", batchfactoryv11.CreateBatchInput{Title: "b", Books: []batchfactoryv11.CreateBookInput{{Title: "k", SourceText: "林晚推门进入客厅。"}}})
	if err != nil {
		t.Fatal(err)
	}
	director := &batchfactoryv11.DirectorService{Store: store, Provider: &directorHTTPProvider{output: directorHTTPJSON}}
	if _, err := director.RunDirector(ctx, "alice", batch.ID, batch.Books[0].ID); err != nil {
		t.Fatal(err)
	}
	batch, err = store.GetBatch(ctx, "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	book := batch.Books[0]
	production := &batchfactoryv11.ProductionService{
		Store:    store,
		Compiler: &batchfactoryv11.PromptCompilerService{Store: store},
		Adapter:  &bookMergeProductionAdapter{},
		Enabled:  true,
		Model:    batchfactoryv11.FrozenVideoModel{ID: "video-model-a", MaxDuration: 15},
	}
	if _, err := production.SubmitBookProduction(ctx, "alice", batch.ID, book.ID, "route-production"); err != nil {
		t.Fatal(err)
	}
	mergeAdapter := &bookMergeRouteAdapter{}
	merge := &batchfactoryv11.MergeService{Store: store, Adapter: mergeAdapter, Enabled: true}
	api := NewRouter(RouterOptions{
		BridgeSecret: "secret",
		Now:          func() time.Time { return now },
		Slice:        5,
		Store:        store,
		Director:     director,
		Compiler:     &batchfactoryv11.PromptCompilerService{Store: store},
		Production:   production,
		Merge:        merge,
	})

	base := "/api/batch-factory/v11/batches/" + batch.ID + "/books/" + book.ID
	post := signedJSONRequest(t, api, now, "alice", http.MethodPost, base+"/merge", map[string]any{
		"requestId":            "route-book-merge",
		"timingMode":           "audio",
		"speed":                0,
		"ttsSpeed":             1.7,
		"audioDurationSeconds": 6.25,
	})
	if post.Code != http.StatusCreated {
		t.Fatalf("POST status=%d body=%s", post.Code, post.Body.String())
	}
	if !strings.Contains(post.Body.String(), `"bookId":"`+book.ID+`"`) || !strings.Contains(post.Body.String(), `"finalJob"`) {
		t.Fatalf("POST body=%s", post.Body.String())
	}
	if len(mergeAdapter.calls) != 2 {
		t.Fatalf("merge calls=%d", len(mergeAdapter.calls))
	}
	if mergeAdapter.calls[0].TimingMode != "speed" || mergeAdapter.calls[0].Speed != 1 {
		t.Fatalf("VIDEO options=%+v", mergeAdapter.calls[0])
	}
	if mergeAdapter.calls[1].TimingMode != "audio" || mergeAdapter.calls[1].Speed != 0 || mergeAdapter.calls[1].AudioDurationSeconds != 6.25 {
		t.Fatalf("Book options=%+v", mergeAdapter.calls[1])
	}

	get := signedJSONRequest(t, api, now, "alice", http.MethodGet, base+"/merge-status?requestId=route-book-merge", nil)
	if get.Code != http.StatusOK {
		t.Fatalf("GET status=%d body=%s", get.Code, get.Body.String())
	}
	if !strings.Contains(get.Body.String(), `"status":"succeeded"`) || !strings.Contains(get.Body.String(), "https://media.example/book.mp4") {
		t.Fatalf("GET body=%s", get.Body.String())
	}
	if len(mergeAdapter.calls) != 2 {
		t.Fatalf("GET must not resubmit completed merge; calls=%d", len(mergeAdapter.calls))
	}
}
