package batchfactoryv11

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type queuedDirectorProvider struct {
	values []string
	calls  []TextCompletionRequest
}

func (p *queuedDirectorProvider) Complete(_ context.Context, input TextCompletionRequest) (string, error) {
	p.calls = append(p.calls, input)
	if len(p.values) == 0 {
		return "", ErrUnavailable
	}
	value := p.values[0]
	p.values = p.values[1:]
	return value, nil
}

func rawSetting(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func seedDirectorBook(t *testing.T, mode string, fixed bool) (*MemoryStore, Batch, Book) {
	t.Helper()
	store := NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", CreateBatchInput{Title: "B", Books: []CreateBookInput{{Title: "K", SourceText: "她被当众羞辱后沉默离开。", Videos: []CreateVideoInput{{Label: "old"}}}}})
	if err != nil {
		t.Fatal(err)
	}
	patch := SettingsPatch{"productionMode": rawSetting(t, mode), "maxVideoDuration": rawSetting(t, 15), "fixedSingleVideo": rawSetting(t, fixed), "aspectRatio": rawSetting(t, "9:16")}
	if fixed {
		patch["fixedVideoDuration"] = rawSetting(t, 9)
	}
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{Patch: patch, ExpectedRevision: batch.Revision}); err != nil {
		t.Fatal(err)
	}
	batch, _ = store.GetBatch(context.Background(), "alice", batch.ID)
	return store, batch, batch.Books[0]
}

func TestViralDirectorRequiresApprovedHookAndBehavioralEscalationContract(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "viral", false)
	provider := &queuedDirectorProvider{values: []string{"她猛地掀翻桌子，当众质问对方。", validDirectorJSON()}}
	service := &DirectorService{Store: store, Provider: provider}
	if _, err := service.RunDirector(context.Background(), "alice", batch.ID, book.ID); err == nil || !strings.Contains(err.Error(), "Hook") {
		t.Fatalf("expected Hook prerequisite, got %v", err)
	}
	hook, err := service.RunHook(context.Background(), "alice", batch.ID, book.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(provider.calls[0].SystemPrompt, "visible conflict") || !strings.Contains(provider.calls[0].SystemPrompt, "behavior escalation") {
		t.Fatal("Hook contract lost visible behavioral escalation")
	}
	if _, err := service.ApproveHook(context.Background(), "alice", batch.ID, book.ID, hook.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RunDirector(context.Background(), "alice", batch.ID, book.ID); err != nil {
		t.Fatal(err)
	}
}

func TestFixedSingleDirectorCreatesOneImmutableVideo(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "original", true)
	provider := &queuedDirectorProvider{values: []string{validDirectorJSON()}}
	service := &DirectorService{Store: store, Provider: provider}
	revision, err := service.RunDirector(context.Background(), "alice", batch.ID, book.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(revision.Videos) != 1 || revision.Videos[0].ID == "" {
		t.Fatalf("revision=%+v", revision)
	}
	if revision.Videos[0].DurationSeconds != 9 {
		t.Fatalf("duration=%v", revision.Videos[0].DurationSeconds)
	}
}

func TestReDirectorPreservesOldVideoOverrideAsOrphaned(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "original", false)
	old := book.Videos[0]
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: old.ID}, SettingsUpdate{Patch: SettingsPatch{"quality": rawSetting(t, "cinematic")}, ExpectedRevision: old.Revision}); err != nil {
		t.Fatal(err)
	}
	provider := &queuedDirectorProvider{values: []string{validDirectorJSON()}}
	revision, err := (&DirectorService{Store: store, Provider: provider}).RunDirector(context.Background(), "alice", batch.ID, book.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(revision.OrphanedOverrides) != 1 || revision.OrphanedOverrides[0].VideoID != old.ID || revision.OrphanedOverrides[0].State != "orphaned" {
		t.Fatalf("orphaned=%+v", revision.OrphanedOverrides)
	}
	if len(revision.Videos) != 1 || revision.Videos[0].ID == old.ID {
		t.Fatalf("video identity was reused: %+v", revision.Videos)
	}
}

func TestDirectorUsesSavedWorkingFrontWithoutChangingCapturedSource(t *testing.T) {
	store := NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", CreateBatchInput{Title: "batch", Books: []CreateBookInput{{Title: "book", SourceText: "captured source"}}})
	if err != nil {
		t.Fatal(err)
	}
	book := batch.Books[0]
	if _, err := store.SaveDraft(context.Background(), "alice", Draft{Key: "working-front:" + book.ID, Kind: "working-front-content", Scope: batch.ID, Content: "edited front"}); err != nil {
		t.Fatal(err)
	}
	service := &DirectorService{Store: store, Provider: &queuedDirectorProvider{values: []string{validDirectorJSON()}}}
	if _, err := service.RunDirector(context.Background(), "alice", batch.ID, book.ID); err != nil {
		t.Fatal(err)
	}
	read, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if read.Books[0].SourceText != "captured source" {
		t.Fatalf("captured source mutated: %q", read.Books[0].SourceText)
	}
	if got := read.Books[0].DirectorRevision.SourceDigest; got != sourceDigest("edited front") {
		t.Fatalf("director digest=%q", got)
	}
}

func TestRewriteWorkingFrontPersistsCandidateWithoutChangingCapturedSource(t *testing.T) {
	store := NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", CreateBatchInput{Title: "batch", Books: []CreateBookInput{{Title: "book", SourceText: "captured source"}}})
	if err != nil {
		t.Fatal(err)
	}
	book := batch.Books[0]
	if _, err := store.SaveDraft(context.Background(), "alice", Draft{Key: "working-front:" + book.ID, Kind: "working-front-content", Scope: batch.ID, Content: "editable front"}); err != nil {
		t.Fatal(err)
	}
	provider := &queuedDirectorProvider{values: []string{"viral candidate"}}
	service := &DirectorService{Store: store, Provider: provider}
	candidate, err := service.RewriteWorkingFront(context.Background(), "alice", batch.ID, book.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if candidate != "viral candidate" {
		t.Fatalf("candidate=%q", candidate)
	}
	if len(provider.calls) != 1 || !strings.Contains(provider.calls[0].UserPrompt, "editable front") {
		t.Fatalf("rewrite must use working front: %+v", provider.calls)
	}
	draft, err := store.GetDraft(context.Background(), "alice", "working-front-candidate:"+book.ID, "working-front-viral-candidate", batch.ID)
	if err != nil || draft.Content != "viral candidate" {
		t.Fatalf("candidate draft=%+v err=%v", draft, err)
	}
	loaded, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil || loaded.Books[0].SourceText != "captured source" {
		t.Fatalf("captured source must remain immutable: book=%+v err=%v", loaded.Books[0], err)
	}
	working, err := store.GetDraft(context.Background(), "alice", "working-front:"+book.ID, "working-front-content", batch.ID)
	if err != nil || working.Content != "editable front" {
		t.Fatalf("working front mutated before replacement: %+v err=%v", working, err)
	}
}

func TestDirectorAppliesSavedAIPromptRulesAndKeepsVisualOutputOutOfVideoPrompt(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "original", false)
	config := map[string]any{
		"assets": map[string]any{
			"enabled":    true,
			"scope":      "all",
			"extraction": map[string]any{"body": "资产统一为国风写实，人物服装必须连续。"},
		},
		"constraints": map[string]any{"enabled": true, "selections": []any{map[string]any{"body": "镜头不得跳轴，不要文字和水印。"}}},
		"video":       map[string]any{"enabled": true, "body": "视频动作必须连续，运镜克制。", "scope": "all"},
		"visual":      map[string]any{"enabled": true, "body": "画面采用冷色电影光，主体清晰。", "scope": "all"},
	}
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, config)}, ExpectedRevision: batch.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	batch, _ = store.GetBatch(context.Background(), "alice", batch.ID)
	book = batch.Books[0]
	output := strings.Replace(validDirectorJSON(), `"video_desc": "林晚进入客厅并握紧玻璃杯。"`, `"video_desc": "林晚进入客厅并握紧玻璃杯。", "visual_prompt": "冷色客厅中林晚紧握玻璃杯，人物清晰。"`, 1)
	provider := &queuedDirectorProvider{values: []string{output}}
	if _, err := (&DirectorService{Store: store, Provider: provider}).RunDirector(context.Background(), "alice", batch.ID, book.ID); err != nil {
		t.Fatal(err)
	}
	if len(provider.calls) != 1 {
		t.Fatalf("director calls=%d", len(provider.calls))
	}
	for _, expected := range []string{"资产统一为国风写实", "镜头不得跳轴", "视频动作必须连续", "画面采用冷色电影光", "visual_prompt"} {
		if !strings.Contains(provider.calls[0].SystemPrompt, expected) {
			t.Fatalf("director contract missing %q:\n%s", expected, provider.calls[0].SystemPrompt)
		}
	}
	latest, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	video := latest.Books[0].Videos[0]
	if video.VisualPrompt != "冷色客厅中林晚紧握玻璃杯，人物清晰。" {
		t.Fatalf("visual prompt=%q", video.VisualPrompt)
	}
	final, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", latest.ID, latest.Books[0].ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(final.CompiledPrompt, video.VisualPrompt) {
		t.Fatalf("visual prompt leaked into final video prompt:\n%s", final.CompiledPrompt)
	}
}

func TestBuildDirectorContractUsesScriptExtractionAndTypedAssetRules(t *testing.T) {
	book := Book{ID: "book-1", Title: "测试书", SourceText: "原文"}
	config := map[string]any{
		"assets": map[string]any{
			"enabled":    true,
			"extraction": map[string]any{"body": "SCRIPT EXTRACTION"},
			"character":  map[string]any{"body": "CHARACTER ONLY"},
			"scene":      map[string]any{"body": "SCENE ONLY"},
			"prop":       map[string]any{"body": "PROP ONLY"},
		},
		"constraints": map[string]any{"enabled": true, "selections": []any{map[string]any{"body": "CONSTRAINT ONLY"}}},
		"video":       map[string]any{"enabled": true, "body": "VIDEO ONLY"},
		"visual":      map[string]any{"enabled": true, "body": "VISUAL ONLY"},
	}
	contract, err := BuildDirectorContract(book, HookRevision{}, DirectorSnapshot{
		Mode: "original", MaxVideoDuration: 15, AspectRatio: "9:16",
		Effective: SettingsPatch{"aiPromptConfig": rawSetting(t, config)},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"SCRIPT EXTRACTION", "CHARACTER ONLY", "SCENE ONLY", "PROP ONLY", "CONSTRAINT ONLY", "VIDEO ONLY", "VISUAL ONLY"} {
		if !strings.Contains(contract.SystemPrompt, expected) {
			t.Fatalf("director contract missing %q:\n%s", expected, contract.SystemPrompt)
		}
	}
}
