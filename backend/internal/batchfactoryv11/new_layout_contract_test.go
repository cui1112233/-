package batchfactoryv11

import (
	"context"
	"strings"
	"testing"
)

func TestNewLayoutDirectorPersistsFirstClassShots(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "original", false)
	provider := &queuedDirectorProvider{values: []string{validDirectorJSON()}}
	if _, err := (&DirectorService{Store: store, Provider: provider}).RunDirector(context.Background(), "alice", batch.ID, book.ID); err != nil {
		t.Fatal(err)
	}

	latest, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(latest.Books) != 1 || len(latest.Books[0].Videos) != 1 {
		t.Fatalf("unexpected hierarchy: %#v", latest.Books)
	}
	video := latest.Books[0].Videos[0]
	if len(video.Shots) != 2 {
		t.Fatalf("expected 2 persisted production shots, got %#v", video.Shots)
	}

	first, second := video.Shots[0], video.Shots[1]
	if first.ID == "" || second.ID == "" || first.ID == second.ID {
		t.Fatalf("shot ids must be stable and distinct: %#v", video.Shots)
	}
	if first.VideoID != video.ID || second.VideoID != video.ID || first.BookID != book.ID || second.BookID != book.ID {
		t.Fatalf("shot ownership must stay inside current book/video: %#v", video.Shots)
	}
	if first.Order != 1 || second.Order != 2 {
		t.Fatalf("shot order must follow Director order: %#v", video.Shots)
	}
	if first.StartSeconds != 0 || first.EndSeconds != 3 || second.StartSeconds != 3 || second.EndSeconds != 9 {
		t.Fatalf("shot timeline must be preserved for story rhythm: %#v", video.Shots)
	}
	if first.TargetDurationSeconds != 6 || second.TargetDurationSeconds != 6 {
		t.Fatalf("every shot must default to a 6-second generation target: %#v", video.Shots)
	}
	if first.Status == "" || second.Status == "" {
		t.Fatalf("each shot must have an independent production status: %#v", video.Shots)
	}
}

func TestNewLayoutVideoCompilerUsesVideoPromptAndNeverVisualPrompt(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	visualOnly := "VISUAL_ONLY_SENTINEL_绝不能进入视频模型"
	videoOnly := "VIDEO_ONLY_SENTINEL_必须进入视频模型"
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{
		Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID,
	}, SettingsUpdate{
		Patch: SettingsPatch{
			"visualPrompt": rawSetting(t, visualOnly),
			"videoPrompt":  rawSetting(t, videoOnly),
		},
		ExpectedRevision: video.Revision,
	}); err != nil {
		t.Fatal(err)
	}

	latest, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(
		context.Background(), "alice", batch.ID, latest.Books[0].ID, latest.Books[0].Videos[0].ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(prompt.CompiledPrompt, visualOnly) {
		t.Fatalf("visualPrompt leaked into video compiled prompt:\n%s", prompt.CompiledPrompt)
	}
	if !strings.Contains(prompt.CompiledPrompt, videoOnly) {
		t.Fatalf("videoPrompt missing from video compiled prompt:\n%s", prompt.CompiledPrompt)
	}
	for _, component := range prompt.Components {
		if component.Key == "visual" {
			t.Fatalf("video compiler must not expose a visual component: %#v", prompt.Components)
		}
	}
}
