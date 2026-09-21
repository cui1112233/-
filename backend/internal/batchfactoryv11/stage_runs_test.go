package batchfactoryv11

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLatestFailedBookStageRunStaysWithinBook(t *testing.T) {
	store := NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", CreateBatchInput{Title: "batch", Books: []CreateBookInput{{Title: "first"}, {Title: "second"}}})
	if err != nil {
		t.Fatal(err)
	}
	first, second := batch.Books[0], batch.Books[1]
	_, err = store.CreateBookStageRun(context.Background(), BookStageRun{Owner: "alice", BatchID: batch.ID, BookID: first.ID, Stage: BookStageImage, Status: ProductionFailed, Attempt: 1, ErrorMessage: "image failed", UpdatedAt: time.Unix(10, 0)})
	if err != nil {
		t.Fatal(err)
	}
	secondFailure, err := store.CreateBookStageRun(context.Background(), BookStageRun{Owner: "alice", BatchID: batch.ID, BookID: second.ID, Stage: BookStageVideo, Status: ProductionFailed, Attempt: 1, ErrorMessage: "video failed", UpdatedAt: time.Unix(20, 0)})
	if err != nil {
		t.Fatal(err)
	}
	all, err := store.ListBookStageRuns(context.Background(), "alice", batch.ID, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].BookID != first.ID || all[0].ID == secondFailure.ID {
		t.Fatalf("runs=%+v second=%+v", all, secondFailure)
	}
	latest := LatestFailedBookStageRun(all)
	if latest == nil || latest.Stage != BookStageImage {
		t.Fatalf("latest=%+v", latest)
	}
}

func TestBookStageServiceRetriesOnlyLatestFailedStageForBook(t *testing.T) {
	store := NewMemoryStore()
	batch, err := store.CreateBatch(context.Background(), "alice", CreateBatchInput{Title: "batch", Books: []CreateBookInput{{Title: "book", SourceText: "source"}}})
	if err != nil {
		t.Fatal(err)
	}
	book := batch.Books[0]
	_, err = store.CreateBookStageRun(context.Background(), BookStageRun{Owner: "alice", BatchID: batch.ID, BookID: book.ID, Stage: BookStageDirector, Status: ProductionFailed, Attempt: 1, ErrorMessage: "director failed"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.CreateBookStageRun(context.Background(), BookStageRun{Owner: "alice", BatchID: batch.ID, BookID: book.ID, Stage: BookStageImage, Status: ProductionFailed, Attempt: 1, ErrorMessage: "image failed"})
	if err != nil {
		t.Fatal(err)
	}
	service := &BookStageService{Store: store}
	summary, err := service.RetryLastFailed(context.Background(), "alice", batch.ID, book.ID, "retry-1", "")
	if err == nil {
		t.Fatal("expected unavailable image retry error")
	}
	if summary.LastFailed == nil || summary.LastFailed.Stage != BookStageImage {
		t.Fatalf("latest failed stage = %#v", summary.LastFailed)
	}
	if len(summary.Runs) != 3 || summary.Runs[2].Stage != BookStageImage || summary.Runs[2].Attempt != 2 {
		t.Fatalf("runs = %#v", summary.Runs)
	}
}

func TestLatestFailedBookStageRunIgnoresFailureResolvedByLaterAttempt(t *testing.T) {
	firstFailure := BookStageRun{ID: "assets-1", Stage: BookStageAssets, Status: ProductionFailed, Attempt: 1, UpdatedAt: time.Unix(10, 0)}
	resolvedRetry := BookStageRun{ID: "assets-2", Stage: BookStageAssets, Status: ProductionSucceeded, Attempt: 2, UpdatedAt: time.Unix(20, 0)}
	directorFailure := BookStageRun{ID: "director-1", Stage: BookStageDirector, Status: ProductionFailed, Attempt: 1, UpdatedAt: time.Unix(15, 0)}

	latest := LatestFailedBookStageRun([]BookStageRun{firstFailure, directorFailure, resolvedRetry})
	if latest == nil || latest.ID != directorFailure.ID {
		t.Fatalf("latest unresolved failure = %#v", latest)
	}
}

func TestNormalizeStageExecutionErrorMarksTextProviderTransportFailureRetryable(t *testing.T) {
	err := normalizeStageExecutionError(BookStageDirector, errors.New("context deadline exceeded"))
	if !errors.Is(err, ErrUnavailable) || !strings.Contains(err.Error(), "文本模型请求失败") {
		t.Fatalf("normalized error = %v", err)
	}
}

func TestBookStageDirectorUsesStructuredH3KernelWhenH3VideoPresetIsSelected(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "h3_v12_complete_director_trace.json"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewMemoryStore()
	source := "五岁的我刚被认回豪门，爸妈就甩下一百万生活费。\n把我和陆晚晚扔在别墅里大眼瞪小眼。\n三个月后，爸妈提前回国，想给我们一个惊喜。"
	batch, err := store.CreateBatch(context.Background(), "alice", CreateBatchInput{Title: "batch", Books: []CreateBookInput{{Title: "book", SourceText: source}}})
	if err != nil {
		t.Fatal(err)
	}
	book := batch.Books[0]
	normalizedSource := strings.Join(h3NonEmptyVideoSourceLines(source), "\n")
	hash := sourceDigest(normalizedSource)
	var fixture map[string]any
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	fixture["video_source_revision"] = "video-source-" + hash[:16] + "-r1"
	fixture["video_source_hash"] = hash
	raw, err = json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	config := map[string]any{
		"originalDirector": map[string]any{"enabled": true, "scope": "all", "presetVersion": 1, "body": "完整 H3 导演结构"},
	}
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID}, SettingsUpdate{Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, config)}, ExpectedRevision: book.Revision}); err != nil {
		t.Fatal(err)
	}
	seedH3CharacterAssets(t, store, batch.ID, book.ID)
	service := &BookStageService{Store: store, H3Director: true, Director: &DirectorService{Store: store, Provider: &queuedDirectorProvider{values: []string{string(raw)}}}}
	if _, err := service.Run(context.Background(), "alice", batch.ID, book.ID, BookStageDirector, StageModeForce, "h3-director-1", ""); err != nil {
		t.Fatalf("H3 director stage failed: %v", err)
	}
	latest, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	revision := latest.Books[0].DirectorRevision
	if revision == nil || revision.Output.H3Director == nil || len(revision.Output.H3Director.DirectorCards) != 3 {
		t.Fatalf("director stage did not persist structured H3 output: %#v", revision)
	}
	if len(revision.Output.Storyboard) != 0 {
		t.Fatalf("H3 stage must not persist legacy storyboard as the director source: %#v", revision.Output.Storyboard)
	}
}

func TestBookStageDirectorUsesUnifiedStructuredFlowForAnyVideoPreset(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "h3_v12_complete_director_trace.json"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewMemoryStore()
	source := "五岁的我刚被认回豪门，爸妈就甩下一百万生活费。\n把我和陆晚晚扔在别墅里大眼瞪小眼。\n三个月后，爸妈提前回国，想给我们一个惊喜。"
	batch, err := store.CreateBatch(context.Background(), "alice", CreateBatchInput{Title: "batch", Books: []CreateBookInput{{Title: "book", SourceText: source}}})
	if err != nil {
		t.Fatal(err)
	}
	book := batch.Books[0]
	normalizedSource := strings.Join(h3NonEmptyVideoSourceLines(source), "\n")
	hash := sourceDigest(normalizedSource)
	var fixture map[string]any
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	fixture["video_source_revision"] = "video-source-" + hash[:16] + "-r1"
	fixture["video_source_hash"] = hash
	fixture["director_preset_key"] = "batch-video-meta"
	fixture["director_preset_revision"] = float64(7)
	raw, err = json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	config := map[string]any{
		"video": map[string]any{"enabled": true, "scope": "all", "presetId": "batch-video-meta", "presetKey": "batch-video-meta", "presetVersion": 7, "body": "CUSTOM VIDEO PRESET RULE"},
	}
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID}, SettingsUpdate{Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, config)}, ExpectedRevision: book.Revision}); err != nil {
		t.Fatal(err)
	}
	seedH3CharacterAssets(t, store, batch.ID, book.ID)
	provider := &queuedDirectorProvider{values: []string{string(raw)}}
	service := &BookStageService{Store: store, Director: &DirectorService{Store: store, Provider: provider}}
	if _, err := service.Run(context.Background(), "alice", batch.ID, book.ID, BookStageDirector, StageModeForce, "generic-director-1", ""); err != nil {
		t.Fatalf("unified director stage failed: %v", err)
	}
	if len(provider.calls) != 1 || !strings.Contains(provider.calls[0].SystemPrompt, "CUSTOM VIDEO PRESET RULE") {
		t.Fatalf("selected video preset was not used as director rule: %#v", provider.calls)
	}
	latest, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	revision := latest.Books[0].DirectorRevision
	if revision == nil || revision.Output.H3Director == nil || len(revision.Output.H3Director.DirectorCards) != 3 {
		t.Fatalf("generic video preset bypassed unified structured director flow: %#v", revision)
	}
}

func TestBookStageVisualRunsWithoutRecreatingDirectorRevision(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "original", false)
	config := map[string]any{"visual": map[string]any{"enabled": true, "scope": "all", "body": "ONLY VISUAL"}}
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID}, SettingsUpdate{Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, config)}, ExpectedRevision: book.Revision}); err != nil {
		t.Fatal(err)
	}
	batch, _ = store.GetBatch(context.Background(), "alice", batch.ID)
	book = batch.Books[0]
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: book.Videos[0].ID}, SettingsUpdate{Patch: SettingsPatch{"videoPrompt": rawSetting(t, "人物站在窗边。")}, ExpectedRevision: book.Videos[0].Revision}); err != nil {
		t.Fatal(err)
	}
	batch, _ = store.GetBatch(context.Background(), "alice", batch.ID)
	book = batch.Books[0]
	service := &BookStageService{Store: store, Director: &DirectorService{Store: store, Provider: &queuedDirectorProvider{values: []string{"画面提示词"}}}}
	summary, err := service.Run(context.Background(), "alice", batch.ID, book.ID, BookStageVisual, StageModeForce, "visual-1", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(summary.Runs) != 1 || summary.Runs[0].Stage != BookStageVisual || summary.Runs[0].Status != ProductionSucceeded {
		t.Fatalf("runs=%+v", summary.Runs)
	}
	latest, _ := store.GetBatch(context.Background(), "alice", batch.ID)
	if latest.Books[0].DirectorRevision != nil || latest.Books[0].Videos[0].VisualPrompt != "画面提示词" {
		t.Fatalf("visual stage must only update visual prompts: %+v", latest.Books[0])
	}
}

func TestBookStageVideoReportsImmediateProviderFailure(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	adapter := &recordingProductionAdapter{ref: ProviderTaskRef{State: ProductionFailed}}
	service := &BookStageService{Store: store, Production: &ProductionService{
		Store: store, Compiler: &PromptCompilerService{Store: store}, Adapter: adapter,
		Enabled: true, Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15},
	}}
	summary, err := service.Run(context.Background(), "alice", batch.ID, book.ID, BookStageVideo, StageModeForce, "video-provider-failure", video.ID)
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected retryable provider error, got %v", err)
	}
	if summary.LastFailed == nil || summary.LastFailed.Stage != BookStageVideo || summary.LastFailed.Status != ProductionFailed {
		t.Fatalf("last failed stage=%+v", summary.LastFailed)
	}
	if !strings.Contains(summary.LastFailed.ErrorMessage, "视频模型") {
		t.Fatalf("missing provider feedback: %+v", summary.LastFailed)
	}
}
