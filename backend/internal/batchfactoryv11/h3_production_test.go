package batchfactoryv11

import (
	"context"
	"errors"
	"testing"
)

func TestH3ProductionSubmitsAndPersistsFrozenCompilationPromptAndTrace(t *testing.T) {
	ctx := context.Background()
	store, batch, book := seedH3DirectorRevision(t)
	document := *book.DirectorRevision.Output.H3Director
	if _, err := store.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{
			"videoModelId": rawSetting(t, "yd2.0-mini"),
		},
		ExpectedRevision: batch.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	seedH3AudioMeasurement(t, store, batch, book, document)
	compiled, err := (&H3KernelService{Store: store}).Compile(ctx, "alice", batch.ID, book.ID, H3KernelCompileRequest{
		FinalPromptOverrides: map[string]H3EditableCopyRevision{"SEG001": {Text: "  完整人工分镜\n[Scene 1] 窗边\n", Revision: 2}},
		DirectorRevisionID:   book.DirectorRevision.ID,
		AudioAssetID:         "audio-1",
		Preset:               completeH3CompileInput(document, H3CanonicalTimeline{}).Preset,
		Switches:             H3PromptSwitches{SmartUnified: true, BaseSetup: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	adapter := &recordingProductionAdapter{ref: ProviderTaskRef{State: ProductionSucceeded, ProviderTaskID: "provider-h3-1", MediaURL: "https://media.example/h3.mp4", RequestedDurationSeconds: 8}}
	service := &ProductionService{
		Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: adapter, Enabled: true,
		Model: FrozenVideoModel{ID: "yd2.0-mini", MaxDuration: 10},
	}
	job, err := service.SubmitBookProductionWithOptions(ctx, "alice", batch.ID, book.ID, "h3-production-1", VideoProviderPersonalAPI, ProductionOptions{CompilationID: compiled.Compilation.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(job.Tasks) != 1 || len(adapter.prompts) != 1 {
		t.Fatalf("job/prompts=%#v %#v", job, adapter.prompts)
	}
	segment := compiled.Compilation.Compilation.Segments[0]
	if segment.CompiledPrompt != "  完整人工分镜\n[Scene 1] 窗边\n" {
		t.Fatal("manual prompt changed before production")
	}
	task := job.Tasks[0]
	if adapter.prompts[0].CompiledPrompt != segment.CompiledPrompt || task.CompiledPrompt != segment.CompiledPrompt {
		t.Fatalf("submitted prompt differs from frozen compilation: prompt=%#v task=%#v", adapter.prompts[0], task)
	}
	if task.FinalPromptHash != segment.CompiledPromptHash || task.CompilationID != compiled.Compilation.ID || task.CompilationSegmentKey != segment.SegmentKey {
		t.Fatalf("production identity not frozen: %#v", task)
	}
	if task.CompileTrace == nil || task.CompileTrace.CompiledPromptHash != segment.CompiledPromptHash || task.RequestedDurationSeconds != 8 {
		t.Fatalf("production trace/duration not frozen: %#v", task)
	}
	stored, err := store.FindProductionJob(ctx, "alice", batch.ID, book.ID, "h3-production-1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Tasks[0].CompileTrace == nil || stored.Tasks[0].CompilationID != compiled.Compilation.ID || stored.Tasks[0].CompiledPrompt != segment.CompiledPrompt {
		t.Fatalf("production restart readback lost H3 trace: %#v", stored.Tasks[0])
	}
}

func TestH3VideoRetryReusesFailedTaskFrozenCompilation(t *testing.T) {
	ctx := context.Background()
	store, batch, book := seedH3DirectorRevision(t)
	document := *book.DirectorRevision.Output.H3Director
	if _, err := store.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{Patch: SettingsPatch{"videoModelId": rawSetting(t, "yd2.0-mini")}, ExpectedRevision: batch.Revision}); err != nil {
		t.Fatal(err)
	}
	seedH3AudioMeasurement(t, store, batch, book, document)
	request := H3KernelCompileRequest{
		DirectorRevisionID: book.DirectorRevision.ID,
		AudioAssetID:       "audio-1",
		Preset:             completeH3CompileInput(document, H3CanonicalTimeline{}).Preset,
		Switches:           H3PromptSwitches{SmartUnified: true, BaseSetup: true},
	}
	first, err := (&H3KernelService{Store: store}).Compile(ctx, "alice", batch.ID, book.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	adapter := &recordingProductionAdapter{ref: ProviderTaskRef{State: ProductionFailed}}
	production := &ProductionService{Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: adapter, Enabled: true, Model: FrozenVideoModel{ID: "yd2.0-mini", MaxDuration: 10}}
	stages := &BookStageService{Store: store, Production: production}
	if _, err := stages.Run(ctx, "alice", batch.ID, book.ID, BookStageVideo, StageModeForce, "h3-failed-1", first.Videos[0].ID); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("initial provider failure=%v", err)
	}
	request.Preset.Key = "h3-video-new-preset"
	request.Preset.Revision++
	request.Preset.OutputConstraints = "new preset output"
	second, err := (&H3KernelService{Store: store}).Compile(ctx, "alice", batch.ID, book.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	if second.Compilation.ID == first.Compilation.ID {
		t.Fatal("test requires a newer compilation")
	}
	adapter.ref = ProviderTaskRef{State: ProductionSucceeded, MediaURL: "https://media.example/retry.mp4"}
	if _, err := stages.RetryLastFailed(ctx, "alice", batch.ID, book.ID, "h3-retry-2", ""); err != nil {
		t.Fatal(err)
	}
	if len(adapter.prompts) != 2 || adapter.prompts[1].CompilationID != first.Compilation.ID || adapter.prompts[1].CompiledPrompt != first.Compilation.Compilation.Segments[0].CompiledPrompt {
		t.Fatalf("retry did not preserve failed compilation: %#v", adapter.prompts)
	}
}
