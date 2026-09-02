package batchfactoryv11

import (
	"context"
	"testing"
)

type recordingMergeAdapter struct {
	calls int
	job   MergeJob
}

func (a *recordingMergeAdapter) Submit(_ context.Context, _ string, _ []MergeMedia, _ MergeOptions) (MergeJob, error) {
	a.calls++
	return a.job, nil
}

func TestMergeRequiresCompletedProductionMediaAndIsIdempotent(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	productionAdapter := &recordingProductionAdapter{ref: ProviderTaskRef{ProviderTaskID: "provider-1", State: ProductionSucceeded, MediaURL: "https://media.example/video.mp4"}}
	production := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: productionAdapter, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	if _, err := production.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "production-for-merge"); err != nil { t.Fatal(err) }
	mergeAdapter := &recordingMergeAdapter{job: MergeJob{Status: MergeSucceeded, OutputURL: "https://media.example/merged.mp4"}}
	merge := &MergeService{Store: store, Adapter: mergeAdapter, Enabled: true}
	first, err := merge.SubmitBatchMerge(context.Background(), "alice", batch.ID, "merge-1", MergeOptions{TimingMode: "speed", Speed: 1.5})
	if err != nil { t.Fatal(err) }
	second, err := merge.SubmitBatchMerge(context.Background(), "alice", batch.ID, "merge-1", MergeOptions{TimingMode: "speed", Speed: 1.5})
	if err != nil { t.Fatal(err) }
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
