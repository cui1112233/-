package batchfactoryv11

import (
	"context"
	"testing"
)

type recordingProductionAdapter struct {
	calls   int
	ref     ProviderTaskRef
	prompts []FinalPrompt
}

func (a *recordingProductionAdapter) Submit(_ context.Context, _ FrozenVideoModel, prompt FinalPrompt) (ProviderTaskRef, error) {
	a.calls++
	a.prompts = append(a.prompts, prompt)
	return a.ref, nil
}

type countingPromptResolver struct {
	delegate PromptResolver
	calls    int
}

type recordingProductionPoller struct {
	calls int
	ref   ProviderTaskRef
}

func (p *recordingProductionPoller) Poll(context.Context, FrozenVideoModel, ProviderTaskRef) (ProviderTaskRef, error) {
	p.calls++
	return p.ref, nil
}

func (r *countingPromptResolver) Compile(ctx context.Context, owner, batchID, bookID, videoID string) (FinalPrompt, error) {
	return r.delegate.Compile(ctx, owner, batchID, bookID, videoID)
}

func (r *countingPromptResolver) CompileShot(ctx context.Context, owner, batchID, bookID, videoID, shotID string) (FinalPrompt, error) {
	r.calls++
	delegate, ok := r.delegate.(ShotPromptResolver)
	if !ok {
		return FinalPrompt{}, ErrUnavailable
	}
	return delegate.CompileShot(ctx, owner, batchID, bookID, videoID, shotID)
}

func TestProductionGateBlocksBeforeCompilerAndAdapter(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	adapter := &recordingProductionAdapter{ref: ProviderTaskRef{State: ProductionSucceeded, MediaURL: "https://media.example/video.mp4"}}
	service := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: adapter, Enabled: false, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	if _, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-1"); err == nil {
		t.Fatal("expected disabled production gate error")
	}
	if adapter.calls != 0 {
		t.Fatalf("disabled gate called adapter %d times", adapter.calls)
	}
}

func TestRepeatedProductionRequestReturnsSameDurableJob(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	adapter := &recordingProductionAdapter{ref: ProviderTaskRef{State: ProductionSucceeded, MediaURL: "https://media.example/video.mp4"}}
	service := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: adapter, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	first, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-1")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == "" || first.ID != second.ID {
		t.Fatalf("jobs differ: first=%+v second=%+v", first, second)
	}
	if len(first.Tasks) != 2 || adapter.calls != 2 {
		t.Fatalf("duplicate request must submit exactly one task per shot once: tasks=%d calls=%d", len(first.Tasks), adapter.calls)
	}
}

func TestProductionStatusPersistsCompilerHashAndMedia(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	adapter := &recordingProductionAdapter{ref: ProviderTaskRef{State: ProductionSucceeded, ProviderTaskID: "provider-1", MediaURL: "https://media.example/video.mp4"}}
	service := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: adapter, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	job, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-1")
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != ProductionSucceeded || len(job.Tasks) != 2 {
		t.Fatalf("job=%+v", job)
	}
	for _, task := range job.Tasks {
		if task.ShotID == "" || task.FinalPromptHash == "" || task.MediaURL != "https://media.example/video.mp4" || task.ProviderTaskID != "provider-1" {
			t.Fatalf("task=%+v", task)
		}
	}
	status, err := service.GetBatchStatus(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Jobs) != 1 || status.Jobs[0].ID != job.ID || status.Jobs[0].Status != ProductionSucceeded || len(status.Jobs[0].Tasks) != 2 {
		t.Fatalf("status=%+v", status)
	}
}

func TestProductionSubmitsExactlyThePromptItPersisted(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	adapter := &recordingProductionAdapter{ref: ProviderTaskRef{State: ProductionSucceeded}}
	compiler := &countingPromptResolver{delegate: &PromptCompilerService{Store: store}}
	service := &ProductionService{Store: store, Compiler: compiler, Adapter: adapter, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	job, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-frozen-prompt")
	if err != nil {
		t.Fatal(err)
	}
	if compiler.calls != len(job.Tasks) {
		t.Fatalf("compiled %d times for %d persisted tasks", compiler.calls, len(job.Tasks))
	}
	if len(adapter.prompts) != len(job.Tasks) {
		t.Fatalf("provider got %d prompts for %d tasks", len(adapter.prompts), len(job.Tasks))
	}
	byShot := map[string]FinalPrompt{}
	for _, prompt := range adapter.prompts {
		byShot[prompt.ShotID] = prompt
	}
	for _, task := range job.Tasks {
		prompt, ok := byShot[task.ShotID]
		if !ok || prompt.SnapshotHash != task.FinalPromptHash || prompt.CompiledPrompt != task.CompiledPrompt {
			t.Fatalf("provider prompt diverged from durable task: prompt=%+v task=%+v", prompt, task)
		}
	}
}

func TestProductionStatusReconcilesRunningProviderTasksPerShot(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	adapter := &recordingProductionAdapter{ref: ProviderTaskRef{ProviderTaskID: "provider-running", State: ProductionRunning}}
	poller := &recordingProductionPoller{ref: ProviderTaskRef{ProviderTaskID: "provider-running", State: ProductionSucceeded, MediaURL: "https://media.example/video.mp4"}}
	service := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: adapter, Poller: poller, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	if _, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-running"); err != nil {
		t.Fatal(err)
	}
	status, err := service.GetBatchStatus(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if poller.calls != 2 || len(status.Jobs) != 1 || status.Jobs[0].Status != ProductionSucceeded || len(status.Jobs[0].Tasks) != 2 {
		t.Fatalf("poller=%+v status=%+v", poller, status)
	}
	for _, task := range status.Jobs[0].Tasks {
		if task.MediaURL == "" || task.ShotID == "" {
			t.Fatalf("shot task not reconciled: %+v", task)
		}
	}
}
