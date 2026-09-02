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

func (r *countingPromptResolver) Compile(ctx context.Context, owner, batchID, bookID, videoID string) (FinalPrompt, error) {
	r.calls++
	return r.delegate.Compile(ctx, owner, batchID, bookID, videoID)
}

func TestProductionGateBlocksBeforeCompilerAndAdapter(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	adapter := &recordingProductionAdapter{ref:ProviderTaskRef{State:"succeeded", MediaURL:"https://media.example/video.mp4"}}
	service := &ProductionService{Store:store, Compiler:&PromptCompilerService{Store:store}, Adapter:adapter, Enabled:false, Model:FrozenVideoModel{ID:"video-model-a", MaxDuration:15}}
	if _, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-1"); err == nil {
		t.Fatal("expected disabled production gate error")
	}
	if adapter.calls != 0 { t.Fatalf("disabled gate called adapter %d times", adapter.calls) }
}

func TestRepeatedProductionRequestReturnsSameDurableJob(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	adapter := &recordingProductionAdapter{ref:ProviderTaskRef{State:"succeeded", MediaURL:"https://media.example/video.mp4"}}
	service := &ProductionService{Store:store, Compiler:&PromptCompilerService{Store:store}, Adapter:adapter, Enabled:true, Model:FrozenVideoModel{ID:"video-model-a", MaxDuration:15}}
	first, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-1")
	if err != nil { t.Fatal(err) }
	second, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-1")
	if err != nil { t.Fatal(err) }
	if first.ID == "" || first.ID != second.ID { t.Fatalf("jobs differ: first=%+v second=%+v", first, second) }
	if adapter.calls != 1 { t.Fatalf("duplicate request submitted %d provider tasks", adapter.calls) }
}

func TestProductionStatusPersistsCompilerHashAndMedia(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	adapter := &recordingProductionAdapter{ref:ProviderTaskRef{State:"succeeded", ProviderTaskID:"provider-1", MediaURL:"https://media.example/video.mp4"}}
	service := &ProductionService{Store:store, Compiler:&PromptCompilerService{Store:store}, Adapter:adapter, Enabled:true, Model:FrozenVideoModel{ID:"video-model-a", MaxDuration:15}}
	job, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-1")
	if err != nil { t.Fatal(err) }
	if job.Status != ProductionSucceeded || len(job.Tasks) != 1 { t.Fatalf("job=%+v", job) }
	task := job.Tasks[0]
	if task.FinalPromptHash == "" || task.MediaURL != "https://media.example/video.mp4" || task.ProviderTaskID != "provider-1" { t.Fatalf("task=%+v", task) }
	status, err := service.GetBatchStatus(context.Background(), "alice", batch.ID)
	if err != nil { t.Fatal(err) }
	if len(status.Jobs) != 1 || status.Jobs[0].ID != job.ID || status.Jobs[0].Status != ProductionSucceeded { t.Fatalf("status=%+v", status) }
}

func TestProductionSubmitsExactlyThePromptItPersisted(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	adapter := &recordingProductionAdapter{ref:ProviderTaskRef{State: ProductionSucceeded}}
	compiler := &countingPromptResolver{delegate: &PromptCompilerService{Store: store}}
	service := &ProductionService{Store: store, Compiler: compiler, Adapter: adapter, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
	job, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-frozen-prompt")
	if err != nil {
		t.Fatal(err)
	}
	if compiler.calls != len(job.Tasks) {
		t.Fatalf("compiled %d times for %d persisted tasks", compiler.calls, len(job.Tasks))
	}
	if len(adapter.prompts) != 1 || adapter.prompts[0].SnapshotHash != job.Tasks[0].FinalPromptHash || adapter.prompts[0].CompiledPrompt != job.Tasks[0].CompiledPrompt {
		t.Fatalf("provider prompt diverged from durable task: prompt=%+v task=%+v", adapter.prompts, job.Tasks[0])
	}
}
