package batchfactoryv11

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

type twoBookH3Fixture struct {
	store         *MemoryStore
	batch         Batch
	markerByVideo map[string]string
	bookByVideo   map[string]string
}

type runningH3RegressionAdapter struct {
	submits []FinalPrompt
	polls   int
}

func (a *runningH3RegressionAdapter) Submit(_ context.Context, _ FrozenVideoModel, prompt FinalPrompt) (ProviderTaskRef, error) {
	a.submits = append(a.submits, prompt)
	id := fmt.Sprintf("h3-regression-%d", len(a.submits))
	return ProviderTaskRef{ProviderTaskID: id, State: ProductionRunning}, nil
}

func (a *runningH3RegressionAdapter) Poll(_ context.Context, _ FrozenVideoModel, ref ProviderTaskRef) (ProviderTaskRef, error) {
	a.polls++
	return ProviderTaskRef{
		ProviderTaskID: ref.ProviderTaskID,
		State:          ProductionSucceeded,
		MediaURL:       "https://media.example/" + ref.ProviderTaskID + ".mp4",
	}, nil
}

func twoBookTwoVideoDirectorJSON(character, scene, prop, firstDesc, secondDesc string) string {
	return fmt.Sprintf(`{
  "characters": [{"name":%q,"prompt":%q}],
  "scenes": [{"name":%q,"prompt":%q}],
  "props": [{"name":%q,"prompt":%q}],
  "storyboard": [
    {
      "id": 1,
      "scene_id": 1,
      "duration_sec": 7,
      "characters": [%q],
      "props": [%q],
      "scene": %q,
      "prefix_key": "modern_conflict",
      "shots": [
        {"start_sec":0,"end_sec":3,"shot_type":"中景","camera":"缓慢推轨","description":%q},
        {"start_sec":3,"end_sec":7,"shot_type":"特写","camera":"固定","description":%q}
      ],
      "video_desc": %q
    },
    {
      "id": 2,
      "scene_id": 1,
      "duration_sec": 8,
      "characters": [%q],
      "props": [%q],
      "scene": %q,
      "prefix_key": "modern_conflict",
      "shots": [
        {"start_sec":0,"end_sec":4,"shot_type":"全景","camera":"横移","description":%q},
        {"start_sec":4,"end_sec":8,"shot_type":"近景","camera":"固定","description":%q}
      ],
      "video_desc": %q
    }
  ]
}`,
		character, character+"角色一致性提示",
		scene, scene+"场景提示",
		prop, prop+"道具提示",
		character, prop, scene, firstDesc+"前半段", firstDesc+"后半段", firstDesc,
		character, prop, scene, secondDesc+"前半段", secondDesc+"后半段", secondDesc,
	)
}

func seedTwoBookMultiVideoH3(t *testing.T) twoBookH3Fixture {
	t.Helper()
	ctx := context.Background()
	store := NewMemoryStore()
	batch, err := store.CreateBatch(ctx, "alice", CreateBatchInput{
		Title: "双书回归",
		Books: []CreateBookInput{
			{Title: "甲书", SourceText: "甲书原文。", Videos: []CreateVideoInput{{Label: "old-a"}}},
			{Title: "乙书", SourceText: "乙书原文。", Videos: []CreateVideoInput{{Label: "old-b"}}},
		},
	})
	if err != nil { t.Fatal(err) }
	if _, err := store.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{
			"productionMode":   rawSetting(t, "original"),
			"maxVideoDuration": rawSetting(t, 15),
			"fixedSingleVideo": rawSetting(t, false),
			"aspectRatio":      rawSetting(t, "9:16"),
			"videoProvider":    rawSetting(t, VideoProviderAutoDLComfyUI),
			"videoModelId":     rawSetting(t, VideoModelMiniMaxH3),
		},
		ExpectedRevision: batch.Revision,
	}); err != nil { t.Fatal(err) }

	batch, err = store.GetBatch(ctx, "alice", batch.ID)
	if err != nil { t.Fatal(err) }
	provider := &queuedDirectorProvider{values: []string{
		twoBookTwoVideoDirectorJSON("林晚", "林家客厅", "玻璃杯", "甲书第一镜头", "甲书第二镜头"),
		twoBookTwoVideoDirectorJSON("沈川", "公司会议室", "手机", "乙书第一镜头", "乙书第二镜头"),
	}}
	director := &DirectorService{Store: store, Provider: provider}
	bookIDs := []string{batch.Books[0].ID, batch.Books[1].ID}
	for _, bookID := range bookIDs {
		if _, err := director.RunDirector(ctx, "alice", batch.ID, bookID); err != nil { t.Fatal(err) }
	}
	batch, err = store.GetBatch(ctx, "alice", batch.ID)
	if err != nil { t.Fatal(err) }
	if len(batch.Books) != 2 || len(batch.Books[0].Videos) != 2 || len(batch.Books[1].Videos) != 2 {
		t.Fatalf("expected 2 books x 2 videos, batch=%+v", batch)
	}

	firstBook := batch.Books[0]
	if _, err := store.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: firstBook.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aspectRatio": rawSetting(t, "16:9")},
		ExpectedRevision: firstBook.Revision,
	}); err != nil { t.Fatal(err) }

	batch, err = store.GetBatch(ctx, "alice", batch.ID)
	if err != nil { t.Fatal(err) }
	markers := []string{"甲书-V1-独立提示", "甲书-V2-独立提示", "乙书-V1-独立提示", "乙书-V2-独立提示"}
	markerByVideo := map[string]string{}
	bookByVideo := map[string]string{}
	markerIndex := 0
	for _, book := range batch.Books {
		for _, video := range book.Videos {
			marker := markers[markerIndex]
			markerIndex++
			if _, err := store.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID}, SettingsUpdate{
				Patch: SettingsPatch{"visualPrompt": rawSetting(t, marker)},
				ExpectedRevision: video.Revision,
			}); err != nil { t.Fatal(err) }
			markerByVideo[video.ID] = marker
			bookByVideo[video.ID] = book.ID
		}
	}
	batch, err = store.GetBatch(ctx, "alice", batch.ID)
	if err != nil { t.Fatal(err) }
	return twoBookH3Fixture{store: store, batch: batch, markerByVideo: markerByVideo, bookByVideo: bookByVideo}
}

func TestBatchProductionH3TwoBooksMultiVideoKeepsFinalPromptsIsolatedAndAggregatesStatus(t *testing.T) {
	fixture := seedTwoBookMultiVideoH3(t)
	adapter := &runningH3RegressionAdapter{}
	service := &ProductionService{
		Store: fixture.store,
		Compiler: &PromptCompilerService{Store: fixture.store},
		Adapter: adapter,
		Enabled: true,
		Model: FrozenVideoModel{ID: VideoModelMiniMaxH3, MaxDuration: 15},
	}
	status, err := service.SubmitBatchProductionWithProvider(context.Background(), "alice", fixture.batch.ID, "dual-book-h3", VideoProviderAutoDLComfyUI)
	if err != nil { t.Fatal(err) }

	if len(adapter.submits) != 4 { t.Fatalf("submit count=%d want=4", len(adapter.submits)) }
	if adapter.polls != 4 { t.Fatalf("poll count=%d want=4", adapter.polls) }

	hashByMarker := map[string]string{}
	for _, prompt := range adapter.submits {
		matched := ""
		for _, marker := range fixture.markerByVideo {
			if strings.Contains(prompt.CompiledPrompt, marker) {
				if matched != "" { t.Fatalf("cross-video prompt leakage: %q and %q in %s", matched, marker, prompt.CompiledPrompt) }
				matched = marker
			}
		}
		if matched == "" { t.Fatalf("submitted FinalPrompt has no video marker: %s", prompt.CompiledPrompt) }
		if prompt.SnapshotHash == "" { t.Fatalf("missing FinalPrompt snapshot hash for %q", matched) }
		hashByMarker[matched] = prompt.SnapshotHash
		if strings.HasPrefix(matched, "甲书-") && !strings.Contains(prompt.CompiledPrompt, "画幅 16:9") {
			t.Fatalf("甲书 book override leaked/lost for %q: %s", matched, prompt.CompiledPrompt)
		}
		if strings.HasPrefix(matched, "乙书-") && !strings.Contains(prompt.CompiledPrompt, "画幅 9:16") {
			t.Fatalf("乙书 inherited settings leaked/lost for %q: %s", matched, prompt.CompiledPrompt)
		}
	}
	if len(hashByMarker) != 4 { t.Fatalf("FinalPrompt hashes are not isolated: %+v", hashByMarker) }

	if status.BatchID != fixture.batch.ID || len(status.Jobs) != 2 {
		t.Fatalf("status summary=%+v", status)
	}
	totalTasks := 0
	seenBooks := map[string]bool{}
	for _, job := range status.Jobs {
		seenBooks[job.BookID] = true
		if job.Status != ProductionSucceeded || len(job.Tasks) != 2 {
			t.Fatalf("job not fully aggregated: %+v", job)
		}
		for _, task := range job.Tasks {
			totalTasks++
			if fixture.bookByVideo[task.VideoID] != job.BookID {
				t.Fatalf("cross-book VIDEO leakage: jobBook=%s task=%+v expectedBook=%s", job.BookID, task, fixture.bookByVideo[task.VideoID])
			}
			marker := fixture.markerByVideo[task.VideoID]
			if task.FinalPromptHash != hashByMarker[marker] {
				t.Fatalf("task FinalPrompt hash mismatch: task=%+v marker=%q hashes=%+v", task, marker, hashByMarker)
			}
			if task.Provider != VideoProviderAutoDLComfyUI || task.Status != ProductionSucceeded || task.MediaURL == "" {
				t.Fatalf("task status/provider summary mismatch: %+v", task)
			}
		}
	}
	if totalTasks != 4 || len(seenBooks) != 2 { t.Fatalf("aggregate totalTasks=%d seenBooks=%+v", totalTasks, seenBooks) }
}

func TestBatchProductionH3UnconfiguredBlocksBeforeFinalPromptAndCreatesNoJobs(t *testing.T) {
	fixture := seedTwoBookMultiVideoH3(t)
	compiler := &countingPromptResolver{delegate: &PromptCompilerService{Store: fixture.store}}
	service := &ProductionService{
		Store: fixture.store,
		Compiler: compiler,
		Enabled: true,
		Model: FrozenVideoModel{ID: VideoModelMiniMaxH3, MaxDuration: 15},
	}
	_, err := service.SubmitBatchProductionWithProvider(context.Background(), "alice", fixture.batch.ID, "unconfigured-h3", VideoProviderAutoDLComfyUI)
	if !errors.Is(err, ErrUnavailable) { t.Fatalf("expected ErrUnavailable, got %v", err) }
	if compiler.calls != 0 { t.Fatalf("unconfigured H3 compiled %d FinalPrompts", compiler.calls) }
	jobs, listErr := fixture.store.ListProductionJobs(context.Background(), "alice", fixture.batch.ID)
	if listErr != nil { t.Fatal(listErr) }
	if len(jobs) != 0 { t.Fatalf("unconfigured H3 created durable jobs: %+v", jobs) }
}
