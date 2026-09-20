package batchfactoryv11

import (
	"context"
	"testing"
)

func TestH3KernelServiceBuildsTimelineCompilationAndEditableVideoCards(t *testing.T) {
	ctx := context.Background()
	store, batch, book := seedH3DirectorRevision(t)
	document := *book.DirectorRevision.Output.H3Director
	service := &H3KernelService{Store: store}
	seedH3AudioMeasurement(t, store, batch, book, document)

	result, err := service.Compile(ctx, "alice", batch.ID, book.ID, H3KernelCompileRequest{
		DirectorRevisionID: book.DirectorRevision.ID,
		AudioAssetID:       "audio-1",
		Preset:             completeH3CompileInput(document, H3CanonicalTimeline{}).Preset,
		Switches:           H3PromptSwitches{SmartUnified: false, BaseSetup: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Timeline.ID == "" || result.Compilation.ID == "" || len(result.Videos) != len(result.Compilation.Compilation.Segments) {
		t.Fatalf("incomplete H3 kernel result: %#v", result)
	}
	latest, err := store.GetBatch(ctx, "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	latestBook, err := bookFromBatch(latest, book.ID)
	if err != nil {
		t.Fatal(err)
	}
	if latestBook.DirectorRevision.ID != book.DirectorRevision.ID || len(latestBook.Videos) != 1 {
		t.Fatalf("director was rerun or video cards missing: %#v", latestBook)
	}
	segment := result.Compilation.Compilation.Segments[0]
	if latestBook.Videos[0].VideoPrompt != segment.EditableCopy || latestBook.Videos[0].DurationSeconds != 7.42 {
		t.Fatalf("VIDEO card does not display editable copy/canonical duration: %#v %#v", latestBook.Videos[0], segment)
	}
	if result.Compilation.Compilation.Analysis.VisualBaseline != h3VisualBaselineText(document.VisualBaseline) || len(result.Compilation.Compilation.Analysis.CharacterSettings) != len(document.CharacterRoster) || len(result.Compilation.Compilation.Analysis.SceneSettings) == 0 {
		t.Fatalf("background H3 analysis was not saved: %#v", result.Compilation.Compilation.Analysis)
	}
}

func TestH3KernelServiceVideoPresetChangeReusesDirectorAndTimeline(t *testing.T) {
	ctx := context.Background()
	store, batch, book := seedH3DirectorRevision(t)
	document := *book.DirectorRevision.Output.H3Director
	service := &H3KernelService{Store: store}
	seedH3AudioMeasurement(t, store, batch, book, document)
	request := H3KernelCompileRequest{
		DirectorRevisionID: book.DirectorRevision.ID,
		AudioAssetID:       "audio-1",
		Preset:             completeH3CompileInput(document, H3CanonicalTimeline{}).Preset,
		Switches:           H3PromptSwitches{SmartUnified: true, BaseSetup: true},
	}
	first, err := service.Compile(ctx, "alice", batch.ID, book.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	request.Preset.Key = "h3-video-cinematic"
	request.Preset.Revision++
	request.Preset.OutputConstraints = "cinematic alternate output"
	second, err := service.Compile(ctx, "alice", batch.ID, book.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	if first.Timeline.ID != second.Timeline.ID || first.Compilation.ID == second.Compilation.ID {
		t.Fatalf("preset recompile did not reuse timeline/create compilation: first=%#v second=%#v", first, second)
	}
	if first.Compilation.Compilation.DirectorRevisionID != second.Compilation.Compilation.DirectorRevisionID {
		t.Fatal("preset recompile changed director revision")
	}
	if first.Videos[0].ID != second.Videos[0].ID {
		t.Fatalf("same segmentation should reuse editable VIDEO card identity: %s != %s", first.Videos[0].ID, second.Videos[0].ID)
	}
}

func TestH3KernelServiceTraceReturnsActualPromptAndLegacyCompatibility(t *testing.T) {
	ctx := context.Background()
	store, batch, book := seedH3DirectorRevision(t)
	document := *book.DirectorRevision.Output.H3Director
	seedH3AudioMeasurement(t, store, batch, book, document)
	compiled, err := (&H3KernelService{Store: store}).Compile(ctx, "alice", batch.ID, book.ID, H3KernelCompileRequest{
		DirectorRevisionID: book.DirectorRevision.ID,
		AudioAssetID:       "audio-1",
		Preset:             completeH3CompileInput(document, H3CanonicalTimeline{}).Preset,
		Switches:           H3PromptSwitches{SmartUnified: true, BaseSetup: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	trace, err := (&H3KernelService{Store: store}).Trace(ctx, "alice", batch.ID, book.ID, compiled.Compilation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if trace.Legacy || trace.DirectorDocument == nil || trace.Timeline.ID != compiled.Timeline.ID || trace.Compilation.ID != compiled.Compilation.ID {
		t.Fatalf("incomplete H3 trace: %#v", trace)
	}
	if got := trace.Compilation.Compilation.Segments[0].CompiledPrompt; got == "" || got != compiled.Compilation.Compilation.Segments[0].CompiledPrompt {
		t.Fatalf("actual model prompt missing from trace: %q", got)
	}

	legacyStore, legacyBatch, legacyBook, _ := seedCompiledVideo(t)
	legacy, err := (&H3KernelService{Store: legacyStore}).Trace(ctx, "alice", legacyBatch.ID, legacyBook.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if !legacy.Legacy || legacy.DirectorDocument != nil {
		t.Fatalf("legacy data was falsely upgraded to H3: %#v", legacy)
	}
}

func seedH3AudioMeasurement(t *testing.T, store H3Repository, batch Batch, book Book, document H3DirectorDocument) H3AudioMeasurementRevision {
	t.Helper()
	revision, err := store.PersistH3AudioMeasurement(context.Background(), "alice", batch.ID, book.ID, H3AudioMeasurement{
		AssetID:             "audio-1",
		ContentHash:         "sha256:audio-1",
		DurationMS:          7420,
		VideoSourceRevision: document.VideoSourceRevision,
		VideoSourceHash:     document.VideoSourceHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	return revision
}

func seedH3DirectorRevision(t *testing.T) (*MemoryStore, Batch, Book) {
	t.Helper()
	store, batch, book := seedDirectorBook(t, "original", false)
	document := mustH3DirectorFixture(t)
	revision, err := store.PersistDirectorRevision(context.Background(), "alice", book, DirectorSnapshot{Mode: "original", MaxVideoDuration: 10, AspectRatio: "9:16"}, "h3-source-digest", "", DirectorResult{H3Director: &document})
	if err != nil {
		t.Fatal(err)
	}
	batch, err = store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	book, err = bookFromBatch(batch, book.ID)
	if err != nil {
		t.Fatal(err)
	}
	if book.DirectorRevision == nil || book.DirectorRevision.ID != revision.ID {
		t.Fatalf("H3 director revision not active: %#v", book.DirectorRevision)
	}
	return store, batch, book
}
