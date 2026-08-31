package batchfactoryv11

import (
	"context"
	"encoding/json"
	"testing"
)

func TestSavingBatchSettingsDoesNotDeleteBookOrVideoOverride(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	batch, err := s.CreateBatch(ctx, "alice", CreateBatchInput{Title: "b", Books: []CreateBookInput{{Title: "book", Videos: []CreateVideoInput{{Label: "v"}}}}})
	if err != nil {
		t.Fatal(err)
	}
	book := batch.Books[0]
	video := book.Videos[0]
	if _, err = s.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID}, SettingsUpdate{Patch: SettingsPatch{"bookOnly": raw(false)}, ExpectedRevision: book.Revision}); err != nil {
		t.Fatal(err)
	}
	updatedBook, _ := s.GetBatch(ctx, "alice", batch.ID)
	book = updatedBook.Books[0]
	video = book.Videos[0]
	if _, err = s.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID}, SettingsUpdate{Patch: SettingsPatch{"videoOnly": raw(0)}, ExpectedRevision: video.Revision}); err != nil {
		t.Fatal(err)
	}
	batch, _ = s.GetBatch(ctx, "alice", batch.ID)
	if _, err = s.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{Patch: SettingsPatch{"batchOnly": raw("")}, ExpectedRevision: batch.Revision}); err != nil {
		t.Fatal(err)
	}
	bookPatch := s.DebugPatch(ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID})
	videoPatch := s.DebugPatch(ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID})
	if string(bookPatch["bookOnly"]) != "false" || string(videoPatch["videoOnly"]) != "0" {
		t.Fatalf("book=%v video=%v", bookPatch, videoPatch)
	}
}

func TestOptimisticRevisionRejectsStaleWrite(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	batch, _ := s.CreateBatch(ctx, "alice", CreateBatchInput{Title: "b"})
	if _, err := s.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{Patch: SettingsPatch{"x": raw(1)}, ExpectedRevision: batch.Revision}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{Patch: SettingsPatch{"x": raw(2)}, ExpectedRevision: batch.Revision}); err != ErrConflict {
		t.Fatalf("err=%v", err)
	}
}

func TestAnotherOwnerCannotReadBatch(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	batch, _ := s.CreateBatch(ctx, "alice", CreateBatchInput{Title: "b"})
	if _, err := s.GetBatch(ctx, "bob", batch.ID); err != ErrNotFound {
		t.Fatalf("err=%v", err)
	}
}

func TestNovelFetchIntakeIsConsumedExactlyOnce(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	intake, err := s.CreateIntake(ctx, "alice", NovelFetchIntakeInput{Books: []CreateBookInput{{ID: "207", Title: "A"}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateBatchFromIntake(ctx, "alice", intake.ID, CreateBatchInput{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateBatchFromIntake(ctx, "alice", intake.ID, CreateBatchInput{}); err != ErrConflict {
		t.Fatalf("err=%v", err)
	}
}

func TestNovelFetchIntakeDeduplicatesSourceBookIDs(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	intake, err := s.CreateIntake(ctx, "alice", NovelFetchIntakeInput{Books: []CreateBookInput{{ID: "207", Title: "A"}, {ID: "207", Title: "duplicate"}, {ID: "208", Title: "B"}}})
	if err != nil {
		t.Fatal(err)
	}
	var got NovelFetchIntakeInput
	if err := json.Unmarshal(intake.Payload, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Books) != 2 || got.Books[0].ID != "207" || got.Books[1].ID != "208" {
		t.Fatalf("books=%+v", got.Books)
	}
}

func TestPromptAndDraftAreOwnerScopedAndDraftRecovers(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	if _, err := s.CreatePrompt(ctx, "alice", Prompt{Name: "p", Kind: "constraint", Content: "alpha"}); err != nil {
		t.Fatal(err)
	}
	if prompts, _ := s.ListPrompts(ctx, "bob", ""); len(prompts) != 0 {
		t.Fatalf("bob prompts=%+v", prompts)
	}
	if _, err := s.SaveDraft(ctx, "alice", Draft{Key: "quality", Kind: "constraint", Scope: "book:1", Content: "draft"}); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetDraft(ctx, "alice", "quality", "constraint", "book:1")
	if err != nil || got.Content != "draft" || got.Revision != 1 {
		t.Fatalf("draft=%+v err=%v", got, err)
	}
	if _, err := s.GetDraft(ctx, "bob", "quality", "constraint", "book:1"); err != ErrNotFound {
		t.Fatalf("cross-owner err=%v", err)
	}
}

func TestSliceOneChangeImpactDoesNotClaimDirectorInvalidation(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	batch, _ := s.CreateBatch(ctx, "alice", CreateBatchInput{Title: "b", Books: []CreateBookInput{{Title: "book", Videos: []CreateVideoInput{{Label: "v"}}}}})
	impact, err := s.ChangeImpact(ctx, "alice", batch.ID, SettingsUpdate{Patch: SettingsPatch{"modelId": raw("new-model")}})
	if err != nil {
		t.Fatal(err)
	}
	if impact.InvalidatesDirector {
		t.Fatalf("Slice 1 must not claim Director invalidation: %+v", impact)
	}
	if impact.AffectedBooks != 1 || impact.AffectedVideos != 1 || !impact.PreservesOverrides {
		t.Fatalf("impact=%+v", impact)
	}
}
