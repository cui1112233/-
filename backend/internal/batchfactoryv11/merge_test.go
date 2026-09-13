package batchfactoryv11

import (
	"context"
	"testing"
)

type recordingMergeAdapter struct {
	calls   int
	job     MergeJob
	sources []MergeMedia
}

func (a *recordingMergeAdapter) Submit(_ context.Context, _ string, sources []MergeMedia, _ MergeOptions) (MergeJob, error) {
	a.calls++
	a.sources = append([]MergeMedia(nil), sources...)
	return a.job, nil
}

func TestMergeRequiresCompletedProductionMediaAndIsIdempotent(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	productionAdapter := &recordingProductionAdapter{ref: ProviderTaskRef{ProviderTaskID: "provider-1", State: ProductionSucceeded, MediaURL: "https://media.example/video.mp4"}}
	production := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: productionAdapter, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	if _, err := production.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "production-for-merge"); err != nil {
		t.Fatal(err)
	}
	mergeAdapter := &recordingMergeAdapter{job: MergeJob{Status: MergeSucceeded, OutputURL: "https://media.example/merged.mp4"}}
	merge := &MergeService{Store: store, Adapter: mergeAdapter, Enabled: true}
	first, err := merge.SubmitBatchMerge(context.Background(), "alice", batch.ID, "merge-1", MergeOptions{TimingMode: "speed", Speed: 1.5})
	if err != nil {
		t.Fatal(err)
	}
	second, err := merge.SubmitBatchMerge(context.Background(), "alice", batch.ID, "merge-1", MergeOptions{TimingMode: "speed", Speed: 1.5})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == "" || first.ID != second.ID || first.Status != MergeSucceeded || mergeAdapter.calls != 1 {
		t.Fatalf("first=%+v second=%+v calls=%d", first, second, mergeAdapter.calls)
	}
}

func TestMergeRejectsBookWithoutCompletedProduction(t *testing.T) {
	store, batch, _, _ := seedCompiledVideo(t)
	merge := &MergeService{Store: store, Adapter: &recordingMergeAdapter{}, Enabled: true}
	if _, err := merge.SubmitBatchMerge(context.Background(), "alice", batch.ID, "merge-incomplete", MergeOptions{}); err == nil {
		t.Fatal("expected incomplete production error")
	}
}

func TestMergeUsesUserSelectedPrimaryMediaVersion(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	oldJob, err := store.CreateProductionJob(context.Background(), ProductionJob{Owner: "alice", BatchID: batch.ID, BookID: book.ID, RequestID: "old", DirectorRevisionID: book.DirectorRevision.ID, Tasks: []ProductionTask{{VideoID: video.ID, Status: ProductionSucceeded, Attempt: 1, FinalPromptHash: "old", CompiledPrompt: "old", MediaURL: "https://media.example/old.mp4"}}})
	if err != nil {
		t.Fatal(err)
	}
	newJob, err := store.CreateProductionJob(context.Background(), ProductionJob{Owner: "alice", BatchID: batch.ID, BookID: book.ID, RequestID: "new", DirectorRevisionID: book.DirectorRevision.ID, Tasks: []ProductionTask{{VideoID: video.ID, Status: ProductionSucceeded, Attempt: 1, FinalPromptHash: "new", CompiledPrompt: "new", MediaURL: "https://media.example/new.mp4"}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID}, SettingsUpdate{Patch: SettingsPatch{"primaryMediaTaskId": rawSetting(t, oldJob.Tasks[0].ID)}, ExpectedRevision: video.Revision}); err != nil {
		t.Fatal(err)
	}
	adapter := &recordingMergeAdapter{job: MergeJob{Status: MergeSucceeded, OutputURL: "https://media.example/merged.mp4"}}
	if _, err := (&MergeService{Store: store, Adapter: adapter, Enabled: true}).SubmitBatchMerge(context.Background(), "alice", batch.ID, "selected-primary", MergeOptions{}); err != nil {
		t.Fatal(err)
	}
	if len(adapter.sources) != 1 || adapter.sources[0].MediaURL != "https://media.example/old.mp4" || adapter.sources[0].ProductionJobID != oldJob.ID || oldJob.ID == newJob.ID {
		t.Fatalf("merge must use selected primary: old=%+v new=%+v sources=%+v", oldJob, newJob, adapter.sources)
	}
}
