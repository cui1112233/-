package batchfactoryv11

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
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
	for _, expected := range []string{"视频提示词：镜头画面：", "00:00-00:03 | 中景｜缓慢推轨 | 林晚进入客厅", "00:03-00:09 | 特写｜固定 | 她握紧玻璃杯", "林晚：18岁中国女性", "林家客厅：现代中式客厅", "玻璃杯：透明厚底玻璃杯", "画面前缀：电影感运镜", "画面约束提示词：高质量商业成片", "负面提示词：不要水印和畸形手指"} {
		if !strings.Contains(value.CompiledPrompt, expected) {
			t.Fatalf("missing %q in\n%s", expected, value.CompiledPrompt)
		}
	}
	if strings.Contains(value.CompiledPrompt, "画面主体：") {
		t.Fatalf("visual prompt leaked into final video prompt:\n%s", value.CompiledPrompt)
	}
	if value.DirectorRevisionID != book.DirectorRevision.ID || value.SnapshotHash != value.EffectiveSettings.SnapshotHash {
		t.Fatalf("prompt identity=%+v", value)
	}
}

func TestFinalPromptUsesH3VideoRendererWhenTheH3PresetIsSelected(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, map[string]any{
			"video": map[string]any{
				"enabled":   true,
				"scope":     "all",
				"presetId":  "batch-video-h3-director",
				"presetKey": "h3-video-normal",
				"body":      "H3 director output renderer",
			},
		})},
		ExpectedRevision: batch.Revision,
	}); err != nil {
		t.Fatal(err)
	}

	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"【人物定义】",
		"<Subject 1> 林晚：18岁中国女性",
		"【H3视听时间轴】",
		"00:00-00:09",
		"镜头1：中景；缓慢推轨；林晚<Subject 1>进入客厅",
		"No on-screen text unless explicitly required by the story.",
	} {
		if !strings.Contains(prompt.CompiledPrompt, expected) {
			t.Fatalf("H3 renderer missing %q in:\n%s", expected, prompt.CompiledPrompt)
		}
	}
	if strings.Contains(prompt.CompiledPrompt, "视频提示词：镜头画面：") {
		t.Fatalf("generic renderer leaked into H3 output:\n%s", prompt.CompiledPrompt)
	}
	if strings.Contains(prompt.CompiledPrompt, "基础设定：") {
		t.Fatalf("the H3 upload grammar must not be wrapped by the generic base-setup component:\n%s", prompt.CompiledPrompt)
	}
	if !strings.Contains(prompt.DisplayPrompt, "镜头画面：") || strings.Contains(prompt.DisplayPrompt, "【H3视听时间轴】") {
		t.Fatalf("the editable card must keep the director prompt, display=%q", prompt.DisplayPrompt)
	}
}

func TestFinalPromptPreviewUsesLatestFrozenH3Compilation(t *testing.T) {
	ctx := context.Background()
	store, batch, book := seedH3DirectorRevision(t)
	document := *book.DirectorRevision.Output.H3Director
	seedH3AudioMeasurement(t, store, batch, book, document)
	compiled, err := (&H3KernelService{Store: store}).Compile(ctx, "alice", batch.ID, book.ID, H3KernelCompileRequest{
		DirectorRevisionID: book.DirectorRevision.ID,
		AudioAssetID:       "audio-1",
		Preset:             completeH3CompileInput(document, H3CanonicalTimeline{}).Preset,
		Switches:           H3PromptSwitches{SmartUnified: true, BaseSetup: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	segment := compiled.Compilation.Compilation.Segments[0]
	prompt, err := (&PromptCompilerService{Store: store}).Compile(ctx, "alice", batch.ID, book.ID, compiled.Videos[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if prompt.CompiledPrompt != segment.CompiledPrompt || prompt.SnapshotHash != segment.CompiledPromptHash {
		t.Fatalf("preview differs from latest frozen H3 submission prompt:\npreview=%#v\nsegment=%#v", prompt, segment)
	}
	if prompt.DisplayPrompt != segment.EditableCopy || prompt.CompilationID != compiled.Compilation.ID {
		t.Fatalf("preview lost separate editable copy or compilation identity: %#v", prompt)
	}
}

func TestH3RendererOmitsAssetDefinitionsWhenBaseSetupIsOff(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, map[string]any{
			"video":       map[string]any{"enabled": true, "scope": "all", "presetKey": h3VideoRendererKey},
			"constraints": map[string]any{"enabled": true, "scope": "all", "baseSetup": map[string]any{"enabled": false}},
		})}, ExpectedRevision: batch.Revision,
	}); err != nil {
		t.Fatal(err)
	}

	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"【人物定义】", "18岁中国女性", "现代中式客厅"} {
		if strings.Contains(prompt.CompiledPrompt, forbidden) {
			t.Fatalf("base setup is off but asset prompt %q entered H3 output:\n%s", forbidden, prompt.CompiledPrompt)
		}
	}
	if !strings.Contains(prompt.CompiledPrompt, "林晚进入客厅") {
		t.Fatalf("base setup must not remove the director's character name and action:\n%s", prompt.CompiledPrompt)
	}
}

func TestFinalPromptExposesReadOnlyBaseSetupForTheStoryboardCard(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"林晚：18岁中国女性", "林家客厅：现代中式客厅"} {
		if !strings.Contains(prompt.BaseSetupPrompt, expected) {
			t.Fatalf("the enabled base setup must be exposed separately for the storyboard card; missing %q in %s", expected, prompt.BaseSetupPrompt)
		}
	}
	if strings.Contains(prompt.BaseSetupPrompt, "玻璃杯：透明厚底玻璃杯") {
		t.Fatalf("the storyboard-card base setup only shows people and scenes, got %s", prompt.BaseSetupPrompt)
	}
}

func TestH3VideoRendererRequiresTheExplicitSmartUnifiedConstraintForItsVisualBaseline(t *testing.T) {
	book := Book{DirectorRevision: &DirectorRevision{Output: DirectorResult{SmartUnifiedStyle: "影像媒介：数字电影；光线与明暗层次：冷暖对照"}}}
	config := AIReasoningPromptConfig{Video: AIReasoningPromptModule{PresetSnapshot: PresetSnapshot{Key: h3VideoRendererKey}}}
	if got := smartUnifiedStyleForRevision(book, config); got != "" {
		t.Fatalf("H3 must not use a visual baseline without the explicit setting, got %q", got)
	}
}

func TestH3RendererCompilesSubjectRhythmAndAudioFromDirectorOutput(t *testing.T) {
	raw := strings.Replace(validDirectorJSON(),
		`"camera":"缓慢推轨","description":"林晚进入客厅"`,
		`"camera":"缓慢推轨","rhythm":"克制推进","audio":"林晚（低声）：“我回来了。”","description":"林晚进入客厅"`,
		1,
	)
	result, err := NormalizeDirectorOutput(json.RawMessage(raw), DirectorSettings{
		MaxVideoDuration: 10,
		AspectRatio:      "9:16",
		AllowedPrefixKeys: []string{
			"modern_conflict",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	prompt := compileH3VideoPrompt(result.Storyboard[0], []compiledAsset{{Name: "林晚", Prompt: "18岁中国女性，黑色长发。"}}, []compiledAsset{{Name: "林家客厅", Prompt: "现代中式客厅。"}}, "")
	for _, expected := range []string{
		"画面：镜头1（节奏：克制推进）：中景；缓慢推轨；林晚<Subject 1>进入客厅",
		"Audio:",
		"镜头1：林晚<Subject 1>（低声）：“我回来了。”",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("H3 canonical output missing %q in:\n%s", expected, prompt)
		}
	}
}

func TestH3RendererKeepsPerShotVisualContextAndLighting(t *testing.T) {
	raw := strings.Replace(validDirectorJSON(),
		`"camera":"缓慢推轨","description":"林晚进入客厅"`,
		`"camera":"缓慢推轨","visual_context":"现代中式客厅，落地窗透入阴天冷光，玻璃杯放在茶几边缘","lighting":"侧向冷光勾勒人物轮廓，暗部保留木材纹理","description":"林晚进入客厅"`,
		1,
	)
	result, err := NormalizeDirectorOutput(json.RawMessage(raw), DirectorSettings{
		MaxVideoDuration: 10, AspectRatio: "9:16", AllowedPrefixKeys: []string{"modern_conflict"},
	})
	if err != nil {
		t.Fatal(err)
	}
	prompt := compileH3VideoPrompt(result.Storyboard[0], []compiledAsset{{Name: "林晚", Prompt: "18岁中国女性，黑色长发。"}}, nil, "")
	for _, expected := range []string{
		"场景：现代中式客厅，落地窗透入阴天冷光，玻璃杯放在茶几边缘",
		"光影：侧向冷光勾勒人物轮廓，暗部保留木材纹理",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("H3 rich visual timeline missing %q in:\n%s", expected, prompt)
		}
	}
}

func TestFinalPromptPreviewKeepsShowingAnExistingOverLimitStoryboard(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID}, SettingsUpdate{
		Patch: SettingsPatch{"duration": rawSetting(t, 12), "storyboardDurationLimit": rawSetting(t, 10)}, ExpectedRevision: video.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	batch, _ = store.GetBatch(context.Background(), "alice", batch.ID)
	book, video = batch.Books[0], batch.Books[0].Videos[0]
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatalf("preview should remain readable for an old over-limit storyboard: %v", err)
	}
	if prompt.DurationSeconds != 12 {
		t.Fatalf("duration=%d", prompt.DurationSeconds)
	}
	if len(prompt.EffectiveSettings.Compatibility) == 0 || prompt.EffectiveSettings.Compatibility[0].State != "incompatible" {
		t.Fatalf("preview must retain the production warning: %+v", prompt.EffectiveSettings.Compatibility)
	}
	if _, err := (&PromptCompilerService{Store: store}).CompileForProduction(context.Background(), "alice", batch.ID, book.ID, video.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("production must still reject the over-limit storyboard: %v", err)
	}
}

func TestFinalPromptIgnoresRetiredVideoStylePrefixSnapshot(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, map[string]any{
			"prefix": map[string]any{"enabled": true, "scope": "all", "presetId": "batch-prefix-modern-conflict", "presetKey": "modern_conflict", "body": "FROZEN PREFIX BODY"},
		})}, ExpectedRevision: batch.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(prompt.CompiledPrompt, "FROZEN PREFIX BODY") {
		t.Fatalf("retired video style prefix leaked into final VIDEO prompt: %s", prompt.CompiledPrompt)
	}
}

func TestFinalPromptMarksSmartUnifiedAsPendingUntilTheDirectorAnalysisExists(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	constraints := map[string]any{"enabled": true, "scope": "all", "selections": []any{
		map[string]any{"presetId": smartUnifiedPrefixPresetID, "constraintCategory": "prefix", "body": "智能统一元提示词不能进入视频提示词"},
	}}
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, map[string]any{"constraints": constraints})}, ExpectedRevision: batch.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !prompt.SmartUnifiedPending {
		t.Fatal("smart unified without a fresh director analysis must be reported as pending")
	}
	if strings.Contains(prompt.CompiledPrompt, "智能统一元提示词不能进入视频提示词") {
		t.Fatalf("smart unified meta prompt leaked into VIDEO prompt: %s", prompt.CompiledPrompt)
	}
}

func TestFinalPromptIncludesSelectedAIReasoningConstraintLayers(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	constraints := map[string]any{
		"enabled": true,
		"scope":   "all",
		"selections": []any{
			map[string]any{"constraintCategory": "prefix", "body": "统一冷青电影光"},
			map[string]any{"constraintCategory": "quality", "body": "4K 细节清晰"},
			map[string]any{"constraintCategory": "restriction", "body": "禁止镜头跳轴"},
			map[string]any{"constraintCategory": "negative", "body": "不要字幕与水印"},
		},
	}
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, map[string]any{"constraints": constraints})}, ExpectedRevision: batch.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"画面前缀：统一冷青电影光", "画面约束提示词：4K 细节清晰", "画面限制：禁止镜头跳轴", "负面提示词：不要字幕与水印"} {
		if !strings.Contains(prompt.CompiledPrompt, expected) {
			t.Fatalf("missing selected constraint %q in\n%s", expected, prompt.CompiledPrompt)
		}
	}
}

func TestFinalPromptUsesTheConfirmedVideoInputOrder(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	constraints := map[string]any{
		"enabled":   true,
		"scope":     "all",
		"baseSetup": map[string]any{"enabled": true},
		"selections": []any{
			map[string]any{"constraintCategory": "prefix", "body": "PREFIX"},
			map[string]any{"constraintCategory": "quality", "body": "QUALITY"},
			map[string]any{"constraintCategory": "restriction", "body": "RESTRICTION"},
			map[string]any{"constraintCategory": "negative", "body": "NEGATIVE"},
		},
	}
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, map[string]any{"constraints": constraints})}, ExpectedRevision: batch.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"画面前缀：PREFIX", "基础设定：", "画面约束提示词：QUALITY", "视频提示词：镜头画面：", "画面限制：RESTRICTION", "负面提示词：NEGATIVE"}
	last := -1
	for _, part := range want {
		at := strings.Index(prompt.CompiledPrompt, part)
		if at < 0 || at <= last {
			t.Fatalf("compiled order must be prefix/base/quality/video/restriction/negative; missing or misplaced %q in:\n%s", part, prompt.CompiledPrompt)
		}
		last = at
	}
	if strings.Contains(prompt.CompiledPrompt, "字幕策略") || strings.Contains(prompt.CompiledPrompt, "视频规格") {
		t.Fatalf("non-prompt transport fields must not be displayed in the final input: %s", prompt.CompiledPrompt)
	}
}

func TestFinalPromptWithConstraintsDisabledContainsOnlyStoryboardPrompt(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, map[string]any{"constraints": map[string]any{"enabled": false}})}, ExpectedRevision: batch.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if prompt.CompiledPrompt != "视频提示词：镜头画面：\n00:00-00:03 | 中景｜缓慢推轨 | 林晚进入客厅\n00:03-00:09 | 特写｜固定 | 她握紧玻璃杯" {
		t.Fatalf("constraints disabled must leave only storyboard prompt, got:\n%s", prompt.CompiledPrompt)
	}
}

func TestFinalPromptUsesPersistedManualBookAsset(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	var character BookAsset
	for _, asset := range book.AssetRecords {
		if asset.Kind == "character" && asset.Name == "林晚" {
			character = asset
			break
		}
	}
	if character.ID == "" {
		t.Fatalf("assets=%+v", book.AssetRecords)
	}
	if _, err := store.UpdateBookAsset(context.Background(), "alice", batch.ID, book.ID, character.ID, UpdateBookAssetInput{Name: character.Name, Prompt: "用户手动确认的角色一致性 Prompt", ExpectedRevision: character.Revision}); err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt.CompiledPrompt, "林晚：用户手动确认的角色一致性 Prompt") || strings.Contains(prompt.CompiledPrompt, "林晚：18岁中国女性") {
		t.Fatalf("compiled prompt=%s", prompt.CompiledPrompt)
	}
}

func TestFinalPromptExcludesDeselectedStoryboardAssetFromTextAndReferences(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	var character, scene BookAsset
	for _, asset := range book.AssetRecords {
		switch {
		case asset.Kind == "character" && asset.Name == "林晚":
			character = asset
		case asset.Kind == "scene" && asset.Name == "林家客厅":
			scene = asset
		}
	}
	if character.ID == "" || scene.ID == "" {
		t.Fatalf("book asset records=%+v", book.AssetRecords)
	}
	for _, asset := range []BookAsset{character, scene} {
		if _, err := store.CreateBookAssetImage(context.Background(), "alice", batch.ID, book.ID, asset.ID, CreateBookAssetImageInput{URL: "https://images.example/" + asset.ID + ".png", MediaType: "image/png", Source: "provider"}); err != nil {
			t.Fatal(err)
		}
	}
	selection := map[string]any{
		"autoAssetIds":     []string{character.ID, scene.ID},
		"addedAssetIds":    []string{},
		"excludedAssetIds": []string{character.ID},
	}
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID}, SettingsUpdate{Patch: SettingsPatch{"assetSelection": rawSetting(t, selection)}, ExpectedRevision: video.Revision}); err != nil {
		t.Fatal(err)
	}
	latest, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	compiled, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, latest.Books[0].ID, latest.Books[0].Videos[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(compiled.CompiledPrompt, "林晚：18岁中国女性") || slices.Contains(compiled.ReferenceImageURLs, "https://images.example/"+character.ID+".png") {
		t.Fatalf("deselected character leaked into production request: %+v\n%s", compiled.ReferenceImageURLs, compiled.CompiledPrompt)
	}
	if !slices.Contains(compiled.ReferenceImageURLs, "https://images.example/"+scene.ID+".png") {
		t.Fatalf("selected scene image missing: %+v", compiled.ReferenceImageURLs)
	}
}

func TestFinalPromptIgnoresLegacyAssetPromptDraftWhenAssetRecordExists(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	if _, err := store.SaveDraft(context.Background(), "alice", Draft{Key: "asset:character:林晚", Kind: "asset-prompt", Scope: batch.ID, Content: "过期草稿"}); err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(prompt.CompiledPrompt, "过期草稿") || !strings.Contains(prompt.CompiledPrompt, "林晚：18岁中国女性") {
		t.Fatalf("compiled prompt=%s", prompt.CompiledPrompt)
	}
}

func TestFinalPromptUsesSavedVideoPromptOverrideWithoutVisualPrompt(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	override := "镜头提示词已由用户确认，保持人物连续性。"
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID}, SettingsUpdate{
		Patch: SettingsPatch{"videoPrompt": rawSetting(t, override)}, ExpectedRevision: video.Revision,
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
	if !strings.Contains(prompt.CompiledPrompt, "视频提示词："+override) {
		t.Fatalf("video prompt override missing=%s", prompt.CompiledPrompt)
	}
	if strings.Contains(prompt.CompiledPrompt, "画面主体：") {
		t.Fatalf("visual prompt leaked into video prompt=%s", prompt.CompiledPrompt)
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

func TestCompiledVideoInputUsesAssetImagesBeforeAssetText(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	var character BookAsset
	for _, asset := range book.AssetRecords {
		if asset.Kind == "character" && asset.Name == "林晚" {
			character = asset
			break
		}
	}
	if character.ID == "" {
		t.Fatalf("book asset records=%+v", book.AssetRecords)
	}
	if _, err := store.CreateBookAssetImage(context.Background(), "alice", batch.ID, book.ID, character.ID, CreateBookAssetImageInput{URL: "https://images.example/lin.png", MediaType: "image/png", Source: "provider"}); err != nil {
		t.Fatal(err)
	}

	input, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(input.CompiledPrompt, "林晚：18岁中国女性") {
		t.Fatalf("primary asset image still injected text: %s", input.CompiledPrompt)
	}
	if !slices.Contains(input.ReferenceImageURLs, "https://images.example/lin.png") {
		t.Fatalf("reference images=%+v", input.ReferenceImageURLs)
	}
}

func TestCompiledVideoInputKeepsAnAssetReferenceImageWhenItsPromptIsBlank(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	var character BookAsset
	for _, asset := range book.AssetRecords {
		if asset.Kind == "character" && asset.Name == "林晚" {
			character = asset
			break
		}
	}
	if character.ID == "" {
		t.Fatalf("book asset records=%+v", book.AssetRecords)
	}
	if _, err := store.CreateBookAssetImage(context.Background(), "alice", batch.ID, book.ID, character.ID, CreateBookAssetImageInput{URL: "https://images.example/lin-image-only.png", MediaType: "image/png", Source: "provider"}); err != nil {
		t.Fatal(err)
	}
	// An image remains a valid VIDEO reference even if its source prompt was
	// deliberately cleared. The "has image, do not send text" rule must not
	// accidentally turn that asset into no input at all.
	owned := store.bookAssets[character.ID]
	owned.Value.Prompt = ""
	store.bookAssets[character.ID] = owned

	input, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, book.ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(input.ReferenceImageURLs, "https://images.example/lin-image-only.png") {
		t.Fatalf("image-only asset was dropped from references=%+v", input.ReferenceImageURLs)
	}
	if strings.Contains(input.CompiledPrompt, "林晚：") {
		t.Fatalf("blank image-only asset leaked text=%s", input.CompiledPrompt)
	}
}

func TestCompiledVideoInputUsesDroppedAssetTextWhenReferenceLimitExceeded(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	for _, asset := range book.AssetRecords {
		if _, err := store.CreateBookAssetImage(context.Background(), "alice", batch.ID, book.ID, asset.ID, CreateBookAssetImageInput{URL: "https://images.example/" + asset.Kind + ".png", MediaType: "image/png", Source: "provider"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID}, SettingsUpdate{Patch: SettingsPatch{"referenceImageLimit": rawSetting(t, 2)}, ExpectedRevision: video.Revision}); err != nil {
		t.Fatal(err)
	}
	latest, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	input, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, latest.Books[0].ID, latest.Books[0].Videos[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	var propID string
	for _, asset := range book.AssetRecords {
		if asset.Kind == "prop" && asset.Name == "玻璃杯" {
			propID = asset.ID
			break
		}
	}
	if len(input.ReferenceImageURLs) != 2 || !slices.Contains(input.DowngradedAssetIDs, propID) {
		t.Fatalf("compiled input=%+v", input)
	}
	if !strings.Contains(input.CompiledPrompt, "玻璃杯：透明厚底玻璃杯") {
		t.Fatalf("dropped asset text missing: %s", input.CompiledPrompt)
	}
	if strings.Contains(input.CompiledPrompt, "画面主体：") {
		t.Fatalf("visual prompt leaked into video prompt: %s", input.CompiledPrompt)
	}
}

func TestFinalPromptAllowsPureTextVideoWhenBaseSetupIsDisabled(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, map[string]any{"constraints": map[string]any{"baseSetup": map[string]any{"enabled": false}}})}, ExpectedRevision: book.Revision,
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
	if !strings.Contains(prompt.CompiledPrompt, "视频提示词：镜头画面：") || !strings.Contains(prompt.CompiledPrompt, "00:00-00:03 | 中景｜缓慢推轨 | 林晚进入客厅") {
		t.Fatalf("video prompt missing: %s", prompt.CompiledPrompt)
	}
	for _, forbidden := range []string{"林晚：18岁中国女性", "林家客厅：现代中式客厅", "玻璃杯：透明厚底玻璃杯"} {
		if strings.Contains(prompt.CompiledPrompt, forbidden) {
			t.Fatalf("base setup disabled but asset prompt leaked %q in %s", forbidden, prompt.CompiledPrompt)
		}
	}
	if len(prompt.ReferenceImageURLs) != 0 {
		t.Fatalf("pure text video should not require references: %+v", prompt.ReferenceImageURLs)
	}
}

func TestFinalPromptBaseSetupUsesOnlyAssetsBoundToTheCurrentShot(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	if _, err := store.CreateBookAsset(context.Background(), "alice", batch.ID, book.ID, CreateBookAssetInput{Kind: "character", Name: "顾遥", Prompt: "短发女律师，深色西装，冷静坚定"}); err != nil {
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
	if strings.Contains(prompt.CompiledPrompt, "顾遥：短发女律师，深色西装，冷静坚定") || strings.Contains(prompt.BaseSetupPrompt, "顾遥：短发女律师，深色西装，冷静坚定") {
		t.Fatalf("an unbound book asset must not leak into this VIDEO prompt or its card setup:\nprovider=%s\ncard=%s", prompt.CompiledPrompt, prompt.BaseSetupPrompt)
	}
	_ = video
}

func TestEffectiveSettingsMergesBookPromptModulesWithTheBatchH3VideoPreset(t *testing.T) {
	store, batch, book, video := seedCompiledVideo(t)
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, map[string]any{
			"video":       map[string]any{"enabled": true, "scope": "all", "presetId": "batch-video-h3-director", "presetKey": h3VideoRendererKey, "body": "H3 renderer"},
			"constraints": map[string]any{"enabled": true, "scope": "all", "baseSetup": map[string]any{"enabled": true}},
		})}, ExpectedRevision: batch.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	latest, err := store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	book = latest.Books[0]
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID}, SettingsUpdate{
		Patch: SettingsPatch{"aiPromptConfig": rawSetting(t, map[string]any{
			"scriptComposition": map[string]any{"general": map[string]any{"presetId": "script-general", "body": "book-only storyboard composition"}},
		})}, ExpectedRevision: book.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	latest, err = store.GetBatch(context.Background(), "alice", batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	prompt, err := (&PromptCompilerService{Store: store}).Compile(context.Background(), "alice", batch.ID, latest.Books[0].ID, video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt.CompiledPrompt, "【H3视听时间轴】") {
		t.Fatalf("a partial book prompt config must retain the batch H3 VIDEO renderer, got:\n%s", prompt.CompiledPrompt)
	}
}
