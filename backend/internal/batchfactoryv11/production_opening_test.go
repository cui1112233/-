package batchfactoryv11

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// failingOpeningVariantCompiler compiles the primary prompt normally but fails
// every opening-variant compilation, to prove a variant failure aborts the
// whole submission before any job or provider task is created.
type failingOpeningVariantCompiler struct {
	delegate *PromptCompilerService
}

func (c *failingOpeningVariantCompiler) Compile(ctx context.Context, owner, batchID, bookID, videoID string) (FinalPrompt, error) {
	return c.delegate.Compile(ctx, owner, batchID, bookID, videoID)
}

func (c *failingOpeningVariantCompiler) CompileForOpeningVariant(context.Context, string, string, string, string, int, int) (FinalPrompt, error) {
	return FinalPrompt{}, errors.New("opening variant compile failed")
}

func TestProductionOpeningVariants(t *testing.T) {
	t.Run("submits one task per successful opening variant", func(t *testing.T) {
		store, batch, book, video := seedCompiledSDOpening(t, []OpeningVariant{
			{Index: 1, Label: "分镜一 | 换开头1", Prompt: "变体一开场", Status: "success"},
			{Index: 2, Label: "分镜一 | 换开头2", Prompt: "变体二开场", Status: "success"},
		})
		adapter := &recordingProductionAdapter{ref: ProviderTaskRef{State: ProductionSucceeded}}
		service := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: adapter, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
		job, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-opening-variants")
		if err != nil {
			t.Fatal(err)
		}
		if len(job.Tasks) != 4 {
			t.Fatalf("tasks=%d, want 4 (video01×3 + video02×1): %+v", len(job.Tasks), job.Tasks)
		}
		video2 := book.Videos[1]
		for index := 0; index <= 2; index++ {
			task := job.Tasks[index]
			if task.VideoID != video.ID || task.OpeningVariantIndex != index {
				t.Fatalf("task[%d]=%+v, want VIDEO01 with OpeningVariantIndex %d", index, task, index)
			}
		}
		if job.Tasks[3].VideoID != video2.ID || job.Tasks[3].OpeningVariantIndex != 0 {
			t.Fatalf("task[3]=%+v, want VIDEO02 with OpeningVariantIndex 0", job.Tasks[3])
		}
		if !strings.Contains(job.Tasks[0].CompiledPrompt, "原开场") {
			t.Fatalf("primary task must keep the original opening:\n%s", job.Tasks[0].CompiledPrompt)
		}
		if !strings.Contains(job.Tasks[1].CompiledPrompt, "变体一开场") {
			t.Fatalf("variant 1 task prompt missing variant text:\n%s", job.Tasks[1].CompiledPrompt)
		}
		if !strings.Contains(job.Tasks[2].CompiledPrompt, "变体二开场") {
			t.Fatalf("variant 2 task prompt missing variant text:\n%s", job.Tasks[2].CompiledPrompt)
		}
		if adapter.calls != 4 {
			t.Fatalf("adapter calls=%d, want 4", adapter.calls)
		}
	})

	t.Run("opening disabled submits one task per video", func(t *testing.T) {
		store, batch, book, _ := seedCompiledSDOpening(t, []OpeningVariant{
			{Index: 1, Label: "分镜一 | 换开头1", Prompt: "变体一开场", Status: "success"},
			{Index: 2, Label: "分镜一 | 换开头2", Prompt: "变体二开场", Status: "success"},
		})
		if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{Patch: SettingsPatch{"openingEnabled": rawSetting(t, false)}, ExpectedRevision: batch.Revision}); err != nil {
			t.Fatal(err)
		}
		adapter := &recordingProductionAdapter{ref: ProviderTaskRef{State: ProductionSucceeded}}
		service := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: adapter, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
		job, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-opening-disabled")
		if err != nil {
			t.Fatal(err)
		}
		if len(job.Tasks) != 2 {
			t.Fatalf("tasks=%d, want 2: %+v", len(job.Tasks), job.Tasks)
		}
		for _, task := range job.Tasks {
			if task.OpeningVariantIndex != 0 {
				t.Fatalf("disabled opening must only submit index 0, got %+v", task)
			}
		}
	})

	t.Run("variant compile failure aborts the whole submission", func(t *testing.T) {
		store, batch, book, _ := seedCompiledSDOpening(t, []OpeningVariant{
			{Index: 1, Label: "分镜一 | 换开头1", Prompt: "变体一开场", Status: "success"},
		})
		adapter := &recordingProductionAdapter{ref: ProviderTaskRef{State: ProductionSucceeded}}
		compiler := &failingOpeningVariantCompiler{delegate: &PromptCompilerService{Store: store}}
		service := &ProductionService{Store: store, Compiler: compiler, Adapter: adapter, Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15}}
		if _, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-variant-failure"); err == nil {
			t.Fatal("expected a variant compile failure to abort the submission")
		}
		if adapter.calls != 0 {
			t.Fatalf("provider must not be called after a compile failure, calls=%d", adapter.calls)
		}
		jobs, err := store.ListProductionJobs(context.Background(), "alice", batch.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(jobs) != 0 {
			t.Fatalf("a failed submission must not persist a partial job, jobs=%+v", jobs)
		}
	})
}
