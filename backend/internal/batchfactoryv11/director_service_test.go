package batchfactoryv11

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type queuedDirectorProvider struct { values []string; calls []TextCompletionRequest }
func (p *queuedDirectorProvider) Complete(_ context.Context, input TextCompletionRequest) (string, error) {
	p.calls = append(p.calls, input)
	if len(p.values) == 0 { return "", ErrUnavailable }
	value := p.values[0]; p.values = p.values[1:]; return value, nil
}

func rawSetting(t *testing.T, value any) json.RawMessage { t.Helper(); raw, err := json.Marshal(value); if err != nil { t.Fatal(err) }; return raw }

func seedDirectorBook(t *testing.T, mode string, fixed bool) (*MemoryStore, Batch, Book) {
	t.Helper()
	store := NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", CreateBatchInput{Title:"B", Books:[]CreateBookInput{{Title:"K", SourceText:"她被当众羞辱后沉默离开。", Videos:[]CreateVideoInput{{Label:"old"}}}}})
	if err != nil { t.Fatal(err) }
	patch := SettingsPatch{"productionMode":rawSetting(t, mode), "maxVideoDuration":rawSetting(t, 15), "fixedSingleVideo":rawSetting(t, fixed), "aspectRatio":rawSetting(t, "9:16")}
	if fixed { patch["fixedVideoDuration"] = rawSetting(t, 9) }
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind:ScopeBatch, BatchID:batch.ID}, SettingsUpdate{Patch:patch, ExpectedRevision:batch.Revision}); err != nil { t.Fatal(err) }
	batch, _ = store.GetBatch(context.Background(), "alice", batch.ID)
	return store, batch, batch.Books[0]
}

func TestViralDirectorRequiresApprovedHookAndBehavioralEscalationContract(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "viral", false)
	provider := &queuedDirectorProvider{values:[]string{"她猛地掀翻桌子，当众质问对方。", validDirectorJSON()}}
	service := &DirectorService{Store:store, Provider:provider}
	if _, err := service.RunDirector(context.Background(), "alice", batch.ID, book.ID); err == nil || !strings.Contains(err.Error(), "Hook") { t.Fatalf("expected Hook prerequisite, got %v", err) }
	hook, err := service.RunHook(context.Background(), "alice", batch.ID, book.ID); if err != nil { t.Fatal(err) }
	if !strings.Contains(provider.calls[0].SystemPrompt, "visible conflict") || !strings.Contains(provider.calls[0].SystemPrompt, "behavior escalation") { t.Fatal("Hook contract lost visible behavioral escalation") }
	if _, err := service.ApproveHook(context.Background(), "alice", batch.ID, book.ID, hook.ID); err != nil { t.Fatal(err) }
	if _, err := service.RunDirector(context.Background(), "alice", batch.ID, book.ID); err != nil { t.Fatal(err) }
}

func TestFixedSingleDirectorCreatesOneImmutableVideo(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "original", true)
	provider := &queuedDirectorProvider{values:[]string{validDirectorJSON()}}
	service := &DirectorService{Store:store, Provider:provider}
	revision, err := service.RunDirector(context.Background(), "alice", batch.ID, book.ID)
	if err != nil { t.Fatal(err) }
	if len(revision.Videos) != 1 || revision.Videos[0].ID == "" { t.Fatalf("revision=%+v", revision) }
	if revision.Videos[0].DurationSeconds != 9 { t.Fatalf("duration=%v", revision.Videos[0].DurationSeconds) }
}

func TestReDirectorPreservesOldVideoOverrideAsOrphaned(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "original", false)
	old := book.Videos[0]
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind:ScopeVideo, BatchID:batch.ID, BookID:book.ID, VideoID:old.ID}, SettingsUpdate{Patch:SettingsPatch{"quality":rawSetting(t,"cinematic")}, ExpectedRevision:old.Revision}); err != nil { t.Fatal(err) }
	provider := &queuedDirectorProvider{values:[]string{validDirectorJSON()}}
	revision, err := (&DirectorService{Store:store, Provider:provider}).RunDirector(context.Background(), "alice", batch.ID, book.ID)
	if err != nil { t.Fatal(err) }
	if len(revision.OrphanedOverrides) != 1 || revision.OrphanedOverrides[0].VideoID != old.ID || revision.OrphanedOverrides[0].State != "orphaned" { t.Fatalf("orphaned=%+v", revision.OrphanedOverrides) }
	if len(revision.Videos) != 1 || revision.Videos[0].ID == old.ID { t.Fatalf("video identity was reused: %+v", revision.Videos) }
}

