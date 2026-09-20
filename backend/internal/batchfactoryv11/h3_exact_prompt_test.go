package batchfactoryv11

import (
	"context"
	"errors"
	"testing"
)

func TestH3PromptEditorShowsAndSubmitsExactFinalText(t *testing.T) {
	d := mustH3DirectorFixture(t)
	input := completeH3CompileInput(d, mustH3Timeline(t, d, 7420))
	original, err := CompileH3VideoSegments(input)
	if err != nil {
		t.Fatal(err)
	}
	if original.Segments[0].EditableCopy != original.Segments[0].CompiledPrompt {
		t.Fatal("editor still shows a separate simplified copy")
	}
	text := "  用户编辑的完整 H3 Prompt\n[Scene 1] 病房\n[Shot 1] 转身。\n"
	input.FinalPromptOverrides = map[string]H3EditableCopyRevision{"SEG001": {Text: text, Revision: 2}}
	edited, err := CompileH3VideoSegments(input)
	if err != nil {
		t.Fatal(err)
	}
	if edited.Segments[0].CompiledPrompt != text || edited.Segments[0].EditableCopy != text {
		t.Fatal("saved prompt was rewritten before submission")
	}
	if edited.Segments[0].CompileTrace.EditableCopySource != "user_final_prompt" {
		t.Fatal("manual final prompt provenance missing")
	}
	if len(edited.Segments[0].CompileTrace.InjectedLayers) != 0 {
		t.Fatalf("manual final prompt falsely claims automatic injection: %v", edited.Segments[0].CompileTrace.InjectedLayers)
	}
	if original.InputHash == edited.InputHash {
		t.Fatal("edit not included in revision identity")
	}
}

func TestH3RecompileProtectsSavedManualPrompt(t *testing.T) {
	store, batch, book := seedH3DirectorRevision(t)
	d := *book.DirectorRevision.Output.H3Director
	seedH3AudioMeasurement(t, store, batch, book, d)
	service := &H3KernelService{Store: store}
	req := H3KernelCompileRequest{DirectorRevisionID: book.DirectorRevision.ID, AudioAssetID: "audio-1", Preset: completeH3CompileInput(d, H3CanonicalTimeline{}).Preset, FinalPromptOverrides: map[string]H3EditableCopyRevision{"SEG001": {Text: "人工最终分镜", Revision: 2}}}
	first, err := service.Compile(context.Background(), "alice", batch.ID, book.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	req.FinalPromptOverrides = nil
	if _, err = service.Compile(context.Background(), "alice", batch.ID, book.ID, req); !errors.Is(err, ErrConflict) {
		t.Fatalf("manual prompt overwritten without approval: %v", err)
	}
	latest, _ := store.LatestH3VideoCompilation(context.Background(), "alice", batch.ID, book.ID, book.DirectorRevision.ID)
	if latest.ID != first.Compilation.ID {
		t.Fatal("failed recompile replaced saved revision")
	}
}
