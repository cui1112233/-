package batchfactoryv11

import (
	"context"
	"errors"
	"testing"
)

type recordingMergeAdapter struct {
	calls   int
	job     MergeJob
	sources []MergeMedia
	options MergeOptions
}

type scriptedMergeAdapter struct {
	results []MergeJob
	calls   int
}

func (a *scriptedMergeAdapter) Submit(_ context.Context, _ string, _ []MergeMedia, _ MergeOptions) (MergeJob, error) {
	result := a.results[a.calls]
	a.calls++
	return result, nil
}

type recordingVideoDurationProbe struct {
	seconds float64
	calls   int
	err     error
}

func (p *recordingVideoDurationProbe) DurationSeconds(_ context.Context, _ string) (float64, error) {
	p.calls++
	return p.seconds, p.err
}

type failingMergePoller struct{}

func (failingMergePoller) Poll(context.Context, string, MergeJob) (MergeJob, error) {
	return MergeJob{}, errors.New("merge provider timed out")
}

func TestMergePollingFailureEndsTheJobWithTheProviderError(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	job, err := store.CreateMergeJob(context.Background(), MergeJob{
		Owner:          "alice",
		BatchID:        batch.ID,
		BookID:         book.ID,
		RequestID:      "merge-poll-failure",
		ProviderTaskID: "provider-merge-1",
		Status:         MergeRunning,
		Sources:        []MergeMedia{{VideoID: "video-1", MediaURL: "https://media.example/video.mp4", Order: 0}},
	})
	if err != nil {
		t.Fatal(err)
	}

	jobs, err := (&MergeService{Store: store, Adapter: &recordingMergeAdapter{}, Poller: failingMergePoller{}, Enabled: true}).GetBatchStatus(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 || jobs[0].ID != job.ID || jobs[0].Status != MergeFailed || jobs[0].ErrorMessage != "merge provider timed out" {
		t.Fatalf("polling failure must finish the job: %+v", jobs)
	}
}

func (a *recordingMergeAdapter) Submit(_ context.Context, _ string, sources []MergeMedia, options MergeOptions) (MergeJob, error) {
	a.calls++
	a.sources = append([]MergeMedia(nil), sources...)
	a.options = options
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

func TestBookMergeReusesSucceededSpeedAndOverwritesFailedSpeed(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	production := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: &recordingProductionAdapter{ref: ProviderTaskRef{ProviderTaskID: "provider-book", State: ProductionSucceeded, MediaURL: "https://media.example/book.mp4"}}, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	if _, err := production.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "production-for-speed-dedupe"); err != nil {
		t.Fatal(err)
	}
	adapter := &scriptedMergeAdapter{results: []MergeJob{
		{Status: MergeFailed, ErrorMessage: "temporary failure"},
		{Status: MergeSucceeded, OutputURL: "https://media.example/recovered.mp4"},
	}}
	merge := &MergeService{Store: store, Adapter: adapter, Enabled: true}
	failedJobs, err := merge.SubmitBookMerge(context.Background(), "alice", batch.ID, book.ID, "merge-speed-failed", MergeOptions{Speed: 1.1})
	if err != nil || len(failedJobs) != 1 || failedJobs[0].Status != MergeFailed {
		t.Fatalf("failed=%+v err=%v", failedJobs, err)
	}
	failed := failedJobs[0]
	recoveredJobs, err := merge.SubmitBookMerge(context.Background(), "alice", batch.ID, book.ID, "merge-speed-retry", MergeOptions{Speed: 1.1})
	if err != nil || len(recoveredJobs) != 1 || recoveredJobs[0].ID != failed.ID || recoveredJobs[0].Status != MergeSucceeded || adapter.calls != 2 {
		t.Fatalf("failed=%+v recovered=%+v calls=%d err=%v", failed, recoveredJobs, adapter.calls, err)
	}
	reusedJobs, err := merge.SubmitBookMerge(context.Background(), "alice", batch.ID, book.ID, "merge-speed-repeat", MergeOptions{Speed: 1.1})
	if err != nil || len(reusedJobs) != 1 || reusedJobs[0].ID != failed.ID || reusedJobs[0].Status != MergeSucceeded || adapter.calls != 2 {
		t.Fatalf("reused=%+v calls=%d err=%v", reusedJobs, adapter.calls, err)
	}
	jobs, err := store.ListMergeJobs(context.Background(), "alice", batch.ID)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("jobs=%+v err=%v", jobs, err)
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

func TestBookMergeScopesFinalOutputToOneBookAndUsesItsSelectedVideos(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	production := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: &recordingProductionAdapter{ref: ProviderTaskRef{ProviderTaskID: "provider-book", State: ProductionSucceeded, MediaURL: "https://media.example/book.mp4", ActualDurationSeconds: 6}}, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	if _, err := production.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "production-for-book-merge"); err != nil {
		t.Fatal(err)
	}
	adapter := &recordingMergeAdapter{job: MergeJob{Status: MergeSucceeded, OutputURL: "https://media.example/book-merged.mp4"}}
	jobs, err := (&MergeService{Store: store, Adapter: adapter, Enabled: true}).SubmitBookMerge(context.Background(), "alice", batch.ID, book.ID, "book-merge-1", MergeOptions{TimingMode: "audio", AudioDurationSeconds: 3})
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 || jobs[0].BookID != book.ID || len(jobs[0].Sources) != 1 || len(adapter.sources) != 1 || adapter.sources[0].ActualDurationSeconds != 6 || adapter.options.AspectRatio != "16:9" || jobs[0].OutputURL != "https://media.example/book-merged.mp4" {
		t.Fatalf("jobs=%+v sources=%+v options=%+v", jobs, adapter.sources, adapter.options)
	}
}

func TestAudioMergeProbesAndPersistsCompletedMediaDurationWhenProviderOmitsIt(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	production := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: &recordingProductionAdapter{ref: ProviderTaskRef{ProviderTaskID: "provider-without-duration", State: ProductionSucceeded, MediaURL: "https://media.example/provider-no-duration.mp4"}}, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	if _, err := production.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "production-no-duration"); err != nil {
		t.Fatal(err)
	}
	probe := &recordingVideoDurationProbe{seconds: 10.125}
	adapter := &recordingMergeAdapter{job: MergeJob{Status: MergeSucceeded, OutputURL: "https://media.example/merged.mp4"}}
	jobs, err := (&MergeService{Store: store, Adapter: adapter, DurationProbe: probe, Enabled: true}).SubmitBookMerge(context.Background(), "alice", batch.ID, book.ID, "merge-probed-duration", MergeOptions{TimingMode: "audio", AudioDurationSeconds: 5})
	if err != nil {
		t.Fatal(err)
	}
	if probe.calls != 1 || len(jobs) != 1 || len(jobs[0].Sources) != 1 || jobs[0].Sources[0].ActualDurationSeconds != 10.125 || adapter.options.Speed != 2.025 {
		t.Fatalf("probe=%+v jobs=%+v options=%+v", probe, jobs, adapter.options)
	}
	productionJobs, err := store.ListProductionJobs(context.Background(), "alice", batch.ID)
	if err != nil || productionJobs[0].Tasks[0].ActualDurationSeconds != 10.125 {
		t.Fatalf("duration must be persisted: jobs=%+v err=%v", productionJobs, err)
	}
}

func TestAudioMergeClassifiesTransientDurationProbeFailureAsUpstream(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	production := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: &recordingProductionAdapter{ref: ProviderTaskRef{ProviderTaskID: "provider-stream-error", State: ProductionSucceeded, MediaURL: "https://media.example/stream.mp4"}}, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	if _, err := production.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "production-stream-error"); err != nil {
		t.Fatal(err)
	}
	probe := &recordingVideoDurationProbe{err: errors.New("stream error: INTERNAL_ERROR")}
	_, err := (&MergeService{Store: store, Adapter: &recordingMergeAdapter{}, DurationProbe: probe, Enabled: true}).SubmitBookMerge(context.Background(), "alice", batch.ID, book.ID, "merge-stream-error", MergeOptions{TimingMode: "audio", AudioDurationSeconds: 5})
	if !errors.Is(err, ErrUpstream) || errors.Is(err, ErrConflict) {
		t.Fatalf("duration stream failure must be retryable upstream error, got %v", err)
	}
}
