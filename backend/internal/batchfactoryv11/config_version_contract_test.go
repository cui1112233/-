package batchfactoryv11

import (
	"context"
	"errors"
	"testing"
)

func TestVersionConfigIDKeyIsCanonical(t *testing.T) {
	if VersionConfigIDKey != "versionConfigId" {
		t.Fatalf("canonical key=%q", VersionConfigIDKey)
	}
}

func TestSaveBatchSettingsAcceptsVisibleConfigVersion(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	batch, _ := s.CreateBatch(ctx, "alice", CreateBatchInput{Title: "b"})
	got, err := s.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{VersionConfigIDKey: raw("system-default-v1")}, ExpectedRevision: batch.Revision,
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(got.Patch[VersionConfigIDKey]) != `"system-default-v1"` {
		t.Fatalf("patch=%v", got.Patch)
	}
}

func TestSaveBatchSettingsRejectsMissingConfigVersion(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	batch, _ := s.CreateBatch(ctx, "alice", CreateBatchInput{Title: "b"})
	_, err := s.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{VersionConfigIDKey: raw("missing-v1")}, ExpectedRevision: batch.Revision,
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err=%v", err)
	}
}

func TestSaveBatchSettingsRejectsCrossOwnerConfigVersion(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	s.configVersions["alice-private-v1"] = memoryOwned[ConfigVersion]{
		Owner: "alice",
		Value: ConfigVersion{ID: "alice-private-v1", Name: "Alice Private"},
	}
	batch, _ := s.CreateBatch(ctx, "bob", CreateBatchInput{Title: "b"})
	_, err := s.SaveSettings(ctx, "bob", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{VersionConfigIDKey: raw("alice-private-v1")}, ExpectedRevision: batch.Revision,
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err=%v", err)
	}
}

func TestConfigVersionCatalogIsOwnerVisible(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	s.configVersions["alice-private-v1"] = memoryOwned[ConfigVersion]{
		Owner: "alice",
		Value: ConfigVersion{ID: "alice-private-v1", Name: "Alice Private"},
	}
	alice, _ := s.ConfigVersions(ctx, "alice")
	bob, _ := s.ConfigVersions(ctx, "bob")
	if !containsConfigVersion(alice, "system-default-v1") || !containsConfigVersion(alice, "alice-private-v1") {
		t.Fatalf("alice=%+v", alice)
	}
	if containsConfigVersion(bob, "alice-private-v1") {
		t.Fatalf("bob saw alice private version: %+v", bob)
	}
}

func TestVersionConfigIDCannotBeWrittenOutsideBatchScope(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	batch, _ := s.CreateBatch(ctx, "alice", CreateBatchInput{Title: "b", Books: []CreateBookInput{{Title: "book"}}})
	book := batch.Books[0]
	_, err := s.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID}, SettingsUpdate{
		Patch: SettingsPatch{VersionConfigIDKey: raw("system-default-v1")}, ExpectedRevision: book.Revision,
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v", err)
	}
}

func TestSavingConfigVersionPreservesBookAndVideoOverrides(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	batch, _ := s.CreateBatch(ctx, "alice", CreateBatchInput{Title: "b", Books: []CreateBookInput{{Title: "book", Videos: []CreateVideoInput{{Label: "v"}}}}})
	book := batch.Books[0]
	video := book.Videos[0]
	if _, err := s.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID}, SettingsUpdate{Patch: SettingsPatch{"bookOnly": raw(false)}, ExpectedRevision: book.Revision}); err != nil {
		t.Fatal(err)
	}
	refreshed, _ := s.GetBatch(ctx, "alice", batch.ID)
	book = refreshed.Books[0]
	video = book.Videos[0]
	if _, err := s.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID}, SettingsUpdate{Patch: SettingsPatch{"videoOnly": raw(0)}, ExpectedRevision: video.Revision}); err != nil {
		t.Fatal(err)
	}
	refreshed, _ = s.GetBatch(ctx, "alice", batch.ID)
	if _, err := s.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{Patch: SettingsPatch{VersionConfigIDKey: raw("system-default-v1")}, ExpectedRevision: refreshed.Revision}); err != nil {
		t.Fatal(err)
	}
	if string(s.DebugPatch(ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID})["bookOnly"]) != "false" {
		t.Fatal("book override lost")
	}
	if string(s.DebugPatch(ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID})["videoOnly"]) != "0" {
		t.Fatal("video override lost")
	}
}

func containsConfigVersion(versions []ConfigVersion, id string) bool {
	for _, version := range versions {
		if version.ID == id {
			return true
		}
	}
	return false
}
