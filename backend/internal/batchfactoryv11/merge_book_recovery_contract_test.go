package batchfactoryv11

import (
	"context"
	"fmt"
	"testing"
)

type restartMergeAdapter struct {
	calls []mergeSubmitCall
}

func (a *restartMergeAdapter) Submit(_ context.Context, batchID string, sources []MergeMedia, options MergeOptions) (MergeJob, error) {
	a.calls = append(a.calls, mergeSubmitCall{BatchID: batchID, Sources: append([]MergeMedia(nil), sources...), Options: options})
	switch len(a.calls) {
	case 1:
		return MergeJob{Status: MergeQueued, ProviderTaskID: "provider-video-1"}, nil
	case 2:
		return MergeJob{Status: MergeQueued, ProviderTaskID: "provider-book-1"}, nil
	default:
		return MergeJob{}, fmt.Errorf("unexpected submit call %d", len(a.calls))
	}
}

type restartMergePoller struct{}

func (p *restartMergePoller) Poll(_ context.Context, _ string, job MergeJob) (MergeJob, error) {
	switch job.Stage {
	case MergeStageVideo:
		return MergeJob{Status: MergeSucceeded, ProviderTaskID: job.ProviderTaskID, OutputURL: "https://media.example/video-after-restart.mp4"}, nil
	case MergeStageBook:
		return MergeJob{Status: MergeSucceeded, ProviderTaskID: job.ProviderTaskID, OutputURL: "https://media.example/book-after-restart.mp4"}, nil
	default:
		return MergeJob{}, fmt.Errorf("unexpected stage %q", job.Stage)
	}
}

func TestBookMergeStatusRecoversQueuedVideoAfterRestartAndSubmitsBookOnce(t *testing.T) {
	ctx := context.Background()
	store, batch, book, _ := seedCompiledVideo(t)
	production := &ProductionService{
		Store:    store,
		Compiler: &PromptCompilerService{Store: store},
		Adapter:  &shotURLProductionAdapter{},
		Enabled:  true,
		Model:    FrozenVideoModel{ID: "video-model-a", MaxDuration: 15},
	}
	if _, err := production.SubmitBookProduction(ctx, "alice", batch.ID, book.ID, "production-before-restart"); err != nil {
		t.Fatal(err)
	}

	adapter := &restartMergeAdapter{}
	firstService := &MergeService{Store: store, Adapter: adapter, Poller: &restartMergePoller{}, Enabled: true}
	initial, err := firstService.SubmitBookMerge(ctx, "alice", batch.ID, book.ID, "restart-root", MergeOptions{
		TimingMode:           "audio",
		Speed:                0,
		TTSSpeed:             1.7,
		AudioDurationSeconds: 6.25,
	})
	if err != nil {
		t.Fatal(err)
	}
	if initial.Status != MergeRunning || initial.FinalJob != nil || len(initial.VideoJobs) != 1 || initial.VideoJobs[0].Status != MergeQueued {
		t.Fatalf("initial=%+v", initial)
	}
	if len(adapter.calls) != 1 {
		t.Fatalf("initial submit calls=%d", len(adapter.calls))
	}

	// Simulate a process restart: a fresh service instance must reconstruct all
	// state from the repository rather than relying on in-memory orchestration.
	restarted := &MergeService{Store: store, Adapter: adapter, Poller: &restartMergePoller{}, Enabled: true}
	progressed, err := restarted.GetBookMergeStatus(ctx, "alice", batch.ID, book.ID, "restart-root")
	if err != nil {
		t.Fatal(err)
	}
	if len(adapter.calls) != 2 {
		t.Fatalf("Book merge must be submitted once after VIDEO success; calls=%d", len(adapter.calls))
	}
	if progressed.Status != MergeRunning || progressed.FinalJob == nil || progressed.FinalJob.Stage != MergeStageBook || progressed.FinalJob.Status != MergeQueued {
		t.Fatalf("progressed=%+v", progressed)
	}
	finalCall := adapter.calls[1]
	if len(finalCall.Sources) != 1 || finalCall.Sources[0].MediaURL != "https://media.example/video-after-restart.mp4" {
		t.Fatalf("final sources=%+v", finalCall.Sources)
	}
	if finalCall.Options.TimingMode != "audio" || finalCall.Options.Speed != 0 || finalCall.Options.TTSSpeed != 1.7 || finalCall.Options.AudioDurationSeconds != 6.25 {
		t.Fatalf("final timing was not recovered: %+v", finalCall.Options)
	}

	// A second restart/poll completes the already-created Book job. It must not
	// submit either VIDEO or Book again.
	restartedAgain := &MergeService{Store: store, Adapter: adapter, Poller: &restartMergePoller{}, Enabled: true}
	completed, err := restartedAgain.GetBookMergeStatus(ctx, "alice", batch.ID, book.ID, "restart-root")
	if err != nil {
		t.Fatal(err)
	}
	if len(adapter.calls) != 2 {
		t.Fatalf("status polling resubmitted merge work; calls=%d", len(adapter.calls))
	}
	if completed.Status != MergeSucceeded || completed.FinalJob == nil || completed.FinalJob.OutputURL != "https://media.example/book-after-restart.mp4" {
		t.Fatalf("completed=%+v", completed)
	}
}
