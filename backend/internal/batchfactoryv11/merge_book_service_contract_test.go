package batchfactoryv11

import (
	"context"
	"fmt"
	"testing"
)

type shotURLProductionAdapter struct{}

func (a *shotURLProductionAdapter) Submit(_ context.Context, _ FrozenVideoModel, prompt FinalPrompt) (ProviderTaskRef, error) {
	if prompt.ShotID == "" {
		return ProviderTaskRef{}, fmt.Errorf("shot id is required")
	}
	return ProviderTaskRef{
		ProviderTaskID: "provider-" + prompt.ShotID,
		State:          ProductionSucceeded,
		MediaURL:       "https://media.example/" + prompt.ShotID + ".mp4",
	}, nil
}

type mergeSubmitCall struct {
	BatchID string
	Sources []MergeMedia
	Options MergeOptions
}

type stagedRecordingMergeAdapter struct {
	calls   []mergeSubmitCall
	results []MergeJob
}

func (a *stagedRecordingMergeAdapter) Submit(_ context.Context, batchID string, sources []MergeMedia, options MergeOptions) (MergeJob, error) {
	a.calls = append(a.calls, mergeSubmitCall{BatchID: batchID, Sources: append([]MergeMedia(nil), sources...), Options: options})
	index := len(a.calls) - 1
	if index >= len(a.results) {
		return MergeJob{}, fmt.Errorf("unexpected merge submit %d", index+1)
	}
	return a.results[index], nil
}

func TestSubmitBookMergeRunsShotToVideoThenVideoToBookExactlyOnce(t *testing.T) {
	ctx := context.Background()
	store, batch, book, _ := seedCompiledVideo(t)
	production := &ProductionService{
		Store:    store,
		Compiler: &PromptCompilerService{Store: store},
		Adapter:  &shotURLProductionAdapter{},
		Enabled:  true,
		Model:    FrozenVideoModel{ID: "video-model-a", MaxDuration: 15},
	}
	productionJob, err := production.SubmitBookProduction(ctx, "alice", batch.ID, book.ID, "production-for-book-merge")
	if err != nil {
		t.Fatal(err)
	}
	if len(productionJob.Tasks) != 2 {
		t.Fatalf("expected two Shot production tasks, got %+v", productionJob.Tasks)
	}

	adapter := &stagedRecordingMergeAdapter{results: []MergeJob{
		{Status: MergeSucceeded, OutputURL: "https://media.example/video-merged.mp4"},
		{Status: MergeSucceeded, OutputURL: "https://media.example/book-final.mp4"},
	}}
	service := &MergeService{Store: store, Adapter: adapter, Enabled: true}
	first, err := service.SubmitBookMerge(ctx, "alice", batch.ID, book.ID, "book-merge-1", MergeOptions{TimingMode: "speed", Speed: 1})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.SubmitBookMerge(ctx, "alice", batch.ID, book.ID, "book-merge-1", MergeOptions{TimingMode: "speed", Speed: 1})
	if err != nil {
		t.Fatal(err)
	}

	if len(adapter.calls) != 2 {
		t.Fatalf("same request must submit exactly VIDEO then Book once; calls=%d", len(adapter.calls))
	}
	videoCall := adapter.calls[0]
	if len(videoCall.Sources) != 2 {
		t.Fatalf("VIDEO merge must receive two Shot sources: %+v", videoCall.Sources)
	}
	if videoCall.Sources[0].ShotID == "" || videoCall.Sources[1].ShotID == "" || videoCall.Sources[0].ShotID == videoCall.Sources[1].ShotID {
		t.Fatalf("VIDEO merge lost Shot identities: %+v", videoCall.Sources)
	}
	if videoCall.Sources[0].Order != 0 || videoCall.Sources[1].Order != 1 {
		t.Fatalf("VIDEO merge lost Shot order: %+v", videoCall.Sources)
	}

	bookCall := adapter.calls[1]
	if len(bookCall.Sources) != 1 || bookCall.Sources[0].MediaURL != "https://media.example/video-merged.mp4" {
		t.Fatalf("Book merge must consume VIDEO output, not raw Shots: %+v", bookCall.Sources)
	}
	if bookCall.Sources[0].Order != 0 {
		t.Fatalf("Book merge lost VIDEO order: %+v", bookCall.Sources)
	}

	if first.Status != MergeSucceeded || first.FinalJob == nil || first.FinalJob.Stage != MergeStageBook || first.FinalJob.OutputURL != "https://media.example/book-final.mp4" {
		t.Fatalf("first status=%+v", first)
	}
	if len(first.VideoJobs) != 1 || first.VideoJobs[0].Stage != MergeStageVideo || first.VideoJobs[0].VideoID == "" {
		t.Fatalf("video jobs=%+v", first.VideoJobs)
	}
	if second.FinalJob == nil || second.FinalJob.ID != first.FinalJob.ID || second.Status != MergeSucceeded {
		t.Fatalf("idempotent status diverged: first=%+v second=%+v", first, second)
	}
}
