package batchfactoryv11

import (
	"context"
	"testing"
)

type recordingProductionAdapter struct {
	calls int
	ref   ProviderTaskRef
}

func (a *recordingProductionAdapter) Submit(_ context.Context, _ FrozenVideoModel, _ FinalPrompt) (ProviderTaskRef, error) {
	a.calls++
	return a.ref, nil
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
