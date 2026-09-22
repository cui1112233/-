package batchfactoryv11

import (
	"context"
	"strings"
	"testing"
)

func TestRunH3DirectorPersistsOnlyValidatedV12DocumentForProcessedVideoSource(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "original", false)
	seedH3CharacterAssets(t, store, batch.ID, book.ID)
	source := H3VideoSource{
		Revision: "video-source-acceptance001-r1",
		Hash:     "7fd4e403990989ac04b829ce336449287ff3cdb27ffdbe4a51f12dfe74ecb198",
		Text: "\n五岁的我刚被认回豪门，爸妈就甩下一百万生活费。\n\n" +
			"把我和陆晚晚扔在别墅里大眼瞪小眼。\n" +
			"三个月后，爸妈提前回国，想给我们一个惊喜。\n",
	}
	provider := &queuedDirectorProvider{values: []string{string(readH3Fixture(t, "h3_v12_complete_director_trace.json"))}}
	service := &DirectorService{Store: store, Provider: provider}

	revision, err := service.RunH3Director(context.Background(), "alice", batch.ID, book.ID, H3DirectorRunRequest{
		VideoSource: source,
		Preset:      H3DirectorPreset{Key: "h3-director-normal", Revision: 1, PromptBody: "完整 H3 导演结构"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if revision.Output.H3Director == nil || len(revision.Output.H3Director.DirectorCards) != 3 {
		t.Fatalf("H3 document not persisted: %#v", revision.Output)
	}
	if len(provider.calls) != 1 || !strings.Contains(provider.calls[0].SystemPrompt, "character_slot_ids") || !strings.Contains(provider.calls[0].SystemPrompt, "不得输出最终秒数") || !strings.Contains(provider.calls[0].SystemPrompt, "必须使用 JSON 数字") || !strings.Contains(provider.calls[0].SystemPrompt, `camera={"shot_size"`) || !strings.Contains(provider.calls[0].SystemPrompt, `character_roster 每项={"slot_id"`) {
		t.Fatalf("incomplete H3 director contract: %#v", provider.calls)
	}
	for _, line := range h3NonEmptyVideoSourceLines(source.Text) {
		if !strings.Contains(provider.calls[0].UserPrompt, line) {
			t.Fatalf("processed video source line missing from prompt: %q", line)
		}
	}
}

func TestRunH3DirectorPersistsTheStructuredStyleSystemResult(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "original", false)
	seedH3CharacterAssets(t, store, batch.ID, book.ID)
	provider := &queuedDirectorProvider{values: []string{string(readH3Fixture(t, "h3_v12_complete_director_trace.json"))}}
	analysis := `{"schema_version":"h3-style-system/v1","prompt":"现代都市短剧；高级电影感；当代都市。","fields":{"final_genre":"现代都市短剧","genre":"现代都市短剧","trailer_style":"高级电影感","story_era":"当代都市","negative_prompt":"无畸形","picture_limit_prompt":"无字幕","quality_constraint_prompt":"画面稳定"},"preset":{"id":"script-constraint-prefix-smart-unified","name":"智能统一","version":7}}`

	sourceText := "五岁的我刚被认回豪门，爸妈就甩下一百万生活费。\n把我和陆晚晚扔在别墅里大眼瞪小眼。\n三个月后，爸妈提前回国，想给我们一个惊喜。"
	revision, err := (&DirectorService{Store: store, Provider: provider}).RunH3Director(context.Background(), "alice", batch.ID, book.ID, H3DirectorRunRequest{
		VideoSource:       H3VideoSource{Revision: "video-source-acceptance001-r1", Hash: sourceDigest(sourceText), Text: sourceText},
		Preset:            H3DirectorPreset{Key: "h3-director-normal", Revision: 1},
		SmartUnifiedStyle: analysis,
	})
	if err != nil {
		t.Fatal(err)
	}
	if revision.Output.SmartUnifiedAnalysis == nil || revision.Output.SmartUnifiedAnalysis.Fields["final_genre"] != "现代都市短剧" {
		t.Fatalf("structured style.system analysis was not persisted: %#v", revision.Output)
	}
	if revision.Output.SmartUnifiedStyle != "现代都市短剧；高级电影感；当代都市。" {
		t.Fatalf("compiled style display=%q", revision.Output.SmartUnifiedStyle)
	}
}

func TestRunH3DirectorSendsOnlyCharacterAssetReferences(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "original", false)
	seedH3CharacterAssets(t, store, batch.ID, book.ID)
	if _, err := store.CreateBookAsset(context.Background(), "alice", batch.ID, book.ID, CreateBookAssetInput{Kind: "scene", Name: "不应发送的历史场景", Prompt: "完整场景资产"}); err != nil {
		t.Fatal(err)
	}
	sourceText := "五岁的我刚被认回豪门，爸妈就甩下一百万生活费。\n把我和陆晚晚扔在别墅里大眼瞪小眼。\n三个月后，爸妈提前回国，想给我们一个惊喜。"
	provider := &queuedDirectorProvider{values: []string{string(readH3Fixture(t, "h3_v12_complete_director_trace.json"))}}
	_, err := (&DirectorService{Store: store, Provider: provider}).RunH3Director(context.Background(), "alice", batch.ID, book.ID, H3DirectorRunRequest{
		VideoSource: H3VideoSource{Revision: "video-source-acceptance001-r1", Hash: sourceDigest(sourceText), Text: sourceText},
		Preset:      H3DirectorPreset{Key: "h3-director-normal", Revision: 1},
	})
	if err != nil {
		t.Fatal(err)
	}
	prompt := provider.calls[0].UserPrompt
	if strings.Contains(prompt, "不应发送的历史场景") || strings.Contains(prompt, "完整场景资产") {
		t.Fatalf("director request leaked the full asset library: %s", prompt)
	}
	if !strings.Contains(prompt, `"asset_id"`) || !strings.Contains(prompt, `"canonical_name"`) {
		t.Fatalf("director request lost compact character binding references: %s", prompt)
	}
}

func TestBuildH3DirectorContractProvidesExistingCharacterAssetsForStableSlotAliases(t *testing.T) {
	source := H3VideoSource{Revision: "video-source-r1", Hash: sourceDigest("江小姐的老公来了。"), Text: "江小姐的老公来了。"}
	assets := []H3DirectorCharacterAsset{
		{AssetID: "asset-jiang", CanonicalName: "江淮雪", Appearance: "年轻女性，医院病房中穿病号服。", Revision: 1},
		{AssetID: "asset-zhou", CanonicalName: "周临", Appearance: "成年男性，身材修长，气质冷峻。", Revision: 1},
	}
	contract := buildH3DirectorContract(source, H3DirectorPreset{Key: "h3-director-normal", Revision: 1}, assets)
	if !strings.Contains(contract.SystemPrompt, "canonical_name 必须优先使用已有人物资产的精确 name") {
		t.Fatalf("director contract does not enforce stable asset names: %s", contract.SystemPrompt)
	}
	if !strings.Contains(contract.SystemPrompt, "不得使用 ?、??、unknown、未知人物作为 slot_id 或连续性对象的键") {
		t.Fatalf("director contract does not forbid unresolved continuity placeholders: %s", contract.SystemPrompt)
	}
	if !strings.Contains(contract.UserPrompt, `"canonical_name":"江淮雪"`) || !strings.Contains(contract.UserPrompt, `"canonical_name":"周临"`) || !strings.Contains(contract.UserPrompt, `"asset_id":"asset-jiang"`) {
		t.Fatalf("director contract lost existing character assets: %s", contract.UserPrompt)
	}
}

func TestDirectorRulesFromVideoPresetExcludesItsFinalPromptTemplate(t *testing.T) {
	body := "原版 H3 导演规则\nDIRECTOR_MUST_COVER_RULES\ncharacter_slot_ids\n## 原 H3：h3.normal.template__v78.3.0.59\n{{.H3_CANONICAL_PROMPT}}\n【批量工厂最终 Prompt 模板】\n{{storyboard}}"
	rules := directorRulesFromVideoPreset(body)
	if !strings.Contains(rules, "character_slot_ids") || !strings.Contains(rules, "DIRECTOR_MUST_COVER_RULES") {
		t.Fatalf("director rules were lost: %q", rules)
	}
	if strings.Contains(rules, "{{storyboard}}") || strings.Contains(rules, "{{.H3_CANONICAL_PROMPT}}") || strings.Contains(rules, "h3.normal.template") || strings.Contains(rules, "最终 Prompt 模板") {
		t.Fatalf("final prompt template leaked into director system prompt: %q", rules)
	}
}

func TestBuildH3DirectorContractEndsWithBatchFactoryOutputAdapter(t *testing.T) {
	contract := buildH3DirectorContract(
		H3VideoSource{Revision: "source-r1", Hash: sourceDigest("第一行"), Text: "第一行"},
		H3DirectorPreset{Key: "h3-director-normal", Revision: 1, PromptBody: "旧终端只返回 timeline_segments JSON"},
		nil,
	)
	lastRules := strings.LastIndex(contract.SystemPrompt, "旧终端只返回 timeline_segments JSON")
	lastAdapter := strings.LastIndex(contract.SystemPrompt, "批量工厂运行期输出适配（最高优先级）")
	if lastRules < 0 || lastAdapter <= lastRules {
		t.Fatalf("output adapter must be the final authority: %s", contract.SystemPrompt)
	}
	if !strings.Contains(contract.SystemPrompt[lastAdapter:], "只输出 h3-director/v1 JSON") {
		t.Fatalf("final adapter lost H3 output contract: %s", contract.SystemPrompt[lastAdapter:])
	}
}

func TestRunH3DirectorRejectsLegacySimplifiedOutput(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "original", false)
	provider := &queuedDirectorProvider{values: []string{`{"characters":[],"scenes":[],"storyboard":[]}`}}
	service := &DirectorService{Store: store, Provider: provider}
	_, err := service.RunH3Director(context.Background(), "alice", batch.ID, book.ID, H3DirectorRunRequest{
		VideoSource: H3VideoSource{Revision: "source-r1", Hash: sourceDigest("第一行"), Text: "第一行"},
		Preset:      H3DirectorPreset{Key: "h3-director-normal", Revision: 1},
	})
	if err == nil || !strings.Contains(err.Error(), "schema_version") {
		t.Fatalf("legacy output must fail instead of being upgraded: %v", err)
	}
}
