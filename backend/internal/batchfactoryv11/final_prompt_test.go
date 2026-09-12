package batchfactoryv11

import (
	"context"
	"strings"
	"testing"
)

func seedCompiledVideo(t *testing.T) (*MemoryStore, Batch, Book, Video) {
	t.Helper()
	store, batch, book := seedDirectorBook(t, "original", false)
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{
			"qualityEnabled":  rawSetting(t, true),
			"quality":         rawSetting(t, "高质量商业成片"),
			"negativeEnabled": rawSetting(t, true),
			"negative":        rawSetting(t, "不要水印和畸形手指"),
		},
		ExpectedRevision: batch.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	batch, _ = store.GetBatch(context.Background(), "alice", batch.ID)
	book = batch.Books[0]
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aspectRatio": rawSetting(t, "16:9")}, ExpectedRevision: book.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	batch, _ = store.GetBatch(context.Background(), "alice", batch.ID)
	book = batch.Books[0]
	provider := &queuedDirectorProvider{values: []string{validDirectorJSON()}}
	if _, err := (&DirectorService{Store: store, Provider: provider}).RunDirector(context.Background(), "alice", batch.ID, book.ID); err != nil {
		t.Fatal(err)
	}
	batch, _ = store.GetBatch(context.Background(), "alice", batch.ID)
	book = batch.Books[0]
	video := book.Videos[0]
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID}, SettingsUpdate{
		Patch: SettingsPatch{"duration": rawSetting(t, 8), "prefixEnabled": rawSetting(t, true), "prefix": rawSetting(t, "电影感运镜")}, ExpectedRevision: video.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	batch, _ = store.GetBatch(context.Background(), "alice", batch.ID)
	return store, batch, batch.Books[0], batch.Books[0].Videos[0]
}

func TestEffectiveSettingsResolveSystemBatchBookVideoWithSources(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	service := &PromptCompilerService{Store: store}
	value, _, _, _, err := service.ResolveEffective(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := rawString(value.Values, "aspectRatio", ""); got != "16:9" || value.SourceByField["aspectRatio"] != "book" {
		t.Fatalf("aspect=%q sources=%+v", got, value.SourceByField)
	}
	if got := rawInt(value.Values, "duration", 0); got != 8 || value.SourceByField["duration"] != "video" {
		t.Fatalf("duration=%d sources=%+v", got, value.SourceByField)
	}
	if value.SourceByField["productionMode"] != "batch" || value.SourceByField["subtitlePolicy"] != "system" {
		t.Fatalf("sources=%+v", value.SourceByField)
	}
	if value.DirectorRevisionID == "" || len(value.SnapshotHash) != 64 {
		t.Fatalf("effective=%+v", value)
	}
}

func TestFinalPromptUsesDirectorAssetsAndEffectiveConstraints(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	value, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"画面主体：林晚进入客厅并握紧玻璃杯。", "林晚：18岁中国女性", "林家客厅：现代中式客厅", "玻璃杯：透明厚底玻璃杯", "画面前缀：modern_conflict；电影感运镜", "画质约束：高质量商业成片", "负面提示词：不要水印和畸形手指", "画幅 16:9；时长 8 秒"} {
		if !strings.Contains(value.CompiledPrompt, expected) {
			t.Fatalf("missing %q in\n%s", expected, value.CompiledPrompt)
		}
	}
	if value.DirectorRevisionID != book.DirectorRevision.ID || value.SnapshotHash != value.EffectiveSettings.SnapshotHash {
		t.Fatalf("prompt identity=%+v", value)
	}
}

func TestFinalPromptUsesSavedAssetPromptDraft(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	if _, err := store.SaveDraft(context.Background(), "alice", Draft{
		Key: "asset:character:林晚", Kind: "asset-prompt", Scope: batch.ID,
		Content: "林晚：用户手动确认的角色一致性 Prompt",
	}); err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt.CompiledPrompt, "林晚：用户手动确认的角色一致性 Prompt") {
		t.Fatalf("compiled prompt=%s", prompt.CompiledPrompt)
	}
	if strings.Contains(prompt.CompiledPrompt, "林晚：18岁中国女性") {
		t.Fatalf("stale AI asset prompt remained: %s", prompt.CompiledPrompt)
	}
}

func TestFinalPromptPrefersBookScopedAssetPromptOverLegacyBatchDraft(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	if _, err := store.SaveDraft(context.Background(), "alice", Draft{
		Key: "asset:character:林晚", Kind: "asset-prompt", Scope: batch.ID,
		Content: "旧批次级角色提示词",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveDraft(context.Background(), "alice", Draft{
		Key: "asset:character:林晚", Kind: "asset-prompt", Scope: batch.ID + ":" + book.ID,
		Content: "仅当前小说的角色提示词",
	}); err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt.CompiledPrompt, "林晚：仅当前小说的角色提示词") || strings.Contains(prompt.CompiledPrompt, "旧批次级角色提示词") {
		t.Fatalf("compiled prompt=%s", prompt.CompiledPrompt)
	}
}

func TestFinalPromptAllowsClearingSavedAssetPromptDraft(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	if _, err := store.SaveDraft(context.Background(), "alice", Draft{
		Key: "asset:character:林晚", Kind: "asset-prompt", Scope: batch.ID, Content: "",
	}); err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(prompt.CompiledPrompt, "林晚：18岁中国女性") {
		t.Fatalf("cleared asset prompt was restored: %s", prompt.CompiledPrompt)
	}
}

func TestFinalPromptUsesSavedVideoPromptOverride(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	override := "镜头提示词已由用户确认，保持人物连续性。"
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID}, SettingsUpdate{
		Patch: SettingsPatch{"visualPrompt": rawSetting(t, override)}, ExpectedRevision: video.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	latest, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, latest.Books[0].ID, latest.Books[0].Videos[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt.CompiledPrompt, "画面主体："+override) {
		t.Fatalf("compiled prompt=%s", prompt.CompiledPrompt)
	}
}

func TestFinalPromptRejectsOrphanedVideoIdentity(t *testing.T) {
	store, batch, book, oldVideo := seedCompiledVideo(t)
	provider := &queuedDirectorProvider{values: []string{validDirectorJSON()}}
	if _, err := (&DirectorService{Store: store, Provider: provider}).RunDirector(context.Background(), "alice", batch.ID, book.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, oldVideo.ID); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for orphaned VIDEO, got %v", err)
	}
}
