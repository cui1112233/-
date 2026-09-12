package batchfactoryv11

import (
	"context"
	"strings"
	"testing"
)

func saveBookAssetImage(t *testing.T, store *MemoryStore, owner, batchID, bookID, category, name, url string) {
	t.Helper()
	if _, err := store.SaveDraft(context.Background(), owner, Draft{
		Key:     "asset:" + category + ":" + name,
		Kind:    "asset-image",
		Scope:   batchID + ":" + bookID,
		Content: url,
	}); err != nil {
		t.Fatal(err)
	}
}

func saveShotDraft(t *testing.T, store *MemoryStore, owner, batchID, bookID, shotID, kind, content string) {
	t.Helper()
	if _, err := store.SaveDraft(context.Background(), owner, Draft{
		Key:     "shot:" + shotID,
		Kind:    kind,
		Scope:   batchID + ":" + bookID,
		Content: content,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestCompileShotUsesCurrentShotReferencesAndImageWinsOverText(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	latest, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	book = latest.Books[0]
	video := book.Videos[0]
	if len(video.Shots) < 1 {
		t.Fatalf("expected hydrated shots: %#v", video)
	}
	shot := video.Shots[0]

	saveBookAssetImage(t, store, "alice", batch.ID, book.ID, "character", "林晚", "https://assets.example/linwan.png")
	saveBookAssetImage(t, store, "alice", batch.ID, book.ID, "scene", "林家客厅", "https://assets.example/living-room.png")
	saveShotDraft(t, store, "alice", batch.ID, book.ID, shot.ID, "visual-image", "https://assets.example/shot-visual.png")
	saveShotDraft(t, store, "alice", batch.ID, book.ID, shot.ID, "video-prompt", "当前 Shot 的独立视频提示词")
	saveShotDraft(t, store, "alice", batch.ID, book.ID, shot.ID, "visual-prompt", "VISUAL_PROMPT_SENTINEL_禁止进入视频模型")

	compiled, err := (&PromptCompilerService{Store: store}).CompileShot(
		context.Background(), "alice", batch.ID, book.ID, video.ID, shot.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.ShotID != shot.ID {
		t.Fatalf("shot identity lost: %+v", compiled)
	}
	if compiled.DurationSeconds != 6 {
		t.Fatalf("shot generation target must be 6 seconds, got %d", compiled.DurationSeconds)
	}
	expectedImages := []string{
		"https://assets.example/shot-visual.png",
		"https://assets.example/linwan.png",
		"https://assets.example/living-room.png",
	}
	if len(compiled.ReferenceImages) != len(expectedImages) {
		t.Fatalf("reference images=%v", compiled.ReferenceImages)
	}
	for index, expected := range expectedImages {
		if compiled.ReferenceImages[index] != expected {
			t.Fatalf("reference images=%v", compiled.ReferenceImages)
		}
	}
	if !strings.Contains(compiled.CompiledPrompt, "当前 Shot 的独立视频提示词") {
		t.Fatalf("shot video prompt missing:\n%s", compiled.CompiledPrompt)
	}
	if strings.Contains(compiled.CompiledPrompt, "林晚：18岁中国女性") {
		t.Fatalf("character has an image, text prompt must not be injected:\n%s", compiled.CompiledPrompt)
	}
	if strings.Contains(compiled.CompiledPrompt, "林家客厅：现代中式客厅") {
		t.Fatalf("scene has an image, text prompt must not be injected:\n%s", compiled.CompiledPrompt)
	}
	if !strings.Contains(compiled.CompiledPrompt, "玻璃杯：透明厚底玻璃杯") {
		t.Fatalf("prop has no image, fallback text should be injected:\n%s", compiled.CompiledPrompt)
	}
	if strings.Contains(compiled.CompiledPrompt, "VISUAL_PROMPT_SENTINEL") {
		t.Fatalf("visual prompt leaked into video prompt:\n%s", compiled.CompiledPrompt)
	}
}

func TestBookProductionCreatesOneIndependentTaskPerShot(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	adapter := &recordingProductionAdapter{ref: ProviderTaskRef{State: ProductionSucceeded, MediaURL: "https://media.example/shot.mp4"}}
	service := &ProductionService{
		Store: store,
		Compiler: &PromptCompilerService{Store: store},
		Adapter: adapter,
		Enabled: true,
		Model: FrozenVideoModel{ID: "video-model-a", MaxDuration: 15},
	}
	job, err := service.SubmitBookProduction(context.Background(), "alice", batch.ID, book.ID, "request-shot-production")
	if err != nil {
		t.Fatal(err)
	}
	latest, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	shots := latest.Books[0].Videos[0].Shots
	if len(shots) != 2 {
		t.Fatalf("fixture expected 2 shots, got %d", len(shots))
	}
	if len(job.Tasks) != 2 || adapter.calls != 2 {
		t.Fatalf("one provider task per shot required: tasks=%+v calls=%d", job.Tasks, adapter.calls)
	}
	seen := map[string]bool{}
	for _, task := range job.Tasks {
		if task.VideoID != latest.Books[0].Videos[0].ID || task.ShotID == "" {
			t.Fatalf("task missing video/shot identity: %+v", task)
		}
		if seen[task.ShotID] {
			t.Fatalf("duplicate shot task: %+v", job.Tasks)
		}
		seen[task.ShotID] = true
	}
	for _, prompt := range adapter.prompts {
		if prompt.ShotID == "" || prompt.DurationSeconds != 6 {
			t.Fatalf("provider must receive shot-scoped 6s prompt: %+v", prompt)
		}
	}
}
