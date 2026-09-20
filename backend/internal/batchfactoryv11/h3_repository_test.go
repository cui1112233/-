package batchfactoryv11

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMemoryStorePersistsH3TimelineAndCompilationIdempotently(t *testing.T) {
	ctx := context.Background()
	store, batch, book, _ := seedCompiledVideo(t)
	document := mustH3DirectorFixture(t)
	timeline := mustH3TimelineForRevision(t, document, book.DirectorRevision.ID, 7420)

	firstTimeline, err := store.PersistH3CanonicalTimeline(ctx, "alice", batch.ID, book.ID, timeline)
	if err != nil {
		t.Fatal(err)
	}
	secondTimeline, err := store.PersistH3CanonicalTimeline(ctx, "alice", batch.ID, book.ID, timeline)
	if err != nil {
		t.Fatal(err)
	}
	if firstTimeline.ID == "" || firstTimeline.ID != secondTimeline.ID {
		t.Fatalf("timeline idempotency failed: %#v %#v", firstTimeline, secondTimeline)
	}
	if _, err := store.GetH3CanonicalTimeline(ctx, "bob", firstTimeline.ID); err != ErrNotFound {
		t.Fatalf("cross-owner timeline read err=%v", err)
	}

	compileInput := completeH3CompileInput(document, timeline)
	compileInput.TimelineID = firstTimeline.ID
	compilation, err := CompileH3VideoSegments(compileInput)
	if err != nil {
		t.Fatal(err)
	}
	firstCompilation, err := store.PersistH3VideoCompilation(ctx, "alice", batch.ID, book.ID, compilation)
	if err != nil {
		t.Fatal(err)
	}
	secondCompilation, err := store.PersistH3VideoCompilation(ctx, "alice", batch.ID, book.ID, compilation)
	if err != nil {
		t.Fatal(err)
	}
	if firstCompilation.ID == "" || firstCompilation.ID != secondCompilation.ID {
		t.Fatalf("compilation idempotency failed: %#v %#v", firstCompilation, secondCompilation)
	}
	got, err := store.GetH3VideoCompilation(ctx, "alice", firstCompilation.ID)
	if err != nil {
		t.Fatal(err)
	}
	wantJSON, _ := json.Marshal(compilation)
	gotJSON, _ := json.Marshal(got.Compilation)
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("compilation round-trip mismatch:\n%s\n%s", gotJSON, wantJSON)
	}
	if _, err := store.GetH3VideoCompilation(ctx, "bob", firstCompilation.ID); err != ErrNotFound {
		t.Fatalf("cross-owner compilation read err=%v", err)
	}
}

func TestMemoryStoreRejectsH3CompilationPointingAtAnotherBookTimeline(t *testing.T) {
	ctx := context.Background()
	store, batch, book, _ := seedCompiledVideo(t)
	document := mustH3DirectorFixture(t)
	timeline := mustH3TimelineForRevision(t, document, book.DirectorRevision.ID, 7420)
	timelineRevision, err := store.PersistH3CanonicalTimeline(ctx, "alice", batch.ID, book.ID, timeline)
	if err != nil {
		t.Fatal(err)
	}
	compilationInput := completeH3CompileInput(document, timeline)
	compilationInput.TimelineID = timelineRevision.ID
	compilation, err := CompileH3VideoSegments(compilationInput)
	if err != nil {
		t.Fatal(err)
	}

	otherBatch, err := store.CreateBatch(ctx, "alice", CreateBatchInput{Title: "other", Books: []CreateBookInput{{Title: "other-book"}}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.PersistH3VideoCompilation(ctx, "alice", otherBatch.ID, otherBatch.Books[0].ID, compilation)
	if err != ErrConflict {
		t.Fatalf("cross-book timeline compilation err=%v", err)
	}
}

func mustH3TimelineForRevision(t *testing.T, document H3DirectorDocument, directorRevisionID string, durationMS int64) H3CanonicalTimeline {
	t.Helper()
	timeline, err := AllocateH3CanonicalTimeline(directorRevisionID, document, H3AudioMeasurement{
		AssetID:             "audio-1",
		ContentHash:         "sha256:audio-1",
		DurationMS:          durationMS,
		VideoSourceRevision: document.VideoSourceRevision,
		VideoSourceHash:     document.VideoSourceHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	return timeline
}
