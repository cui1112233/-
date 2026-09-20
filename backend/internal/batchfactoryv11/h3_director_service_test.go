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

func TestBuildH3DirectorContractProvidesExistingCharacterAssetsForStableSlotAliases(t *testing.T) {
	source := H3VideoSource{Revision: "video-source-r1", Hash: sourceDigest("江小姐的老公来了。"), Text: "江小姐的老公来了。"}
	assets := []NamedPrompt{
		{Name: "江淮雪", Prompt: "年轻女性，医院病房中穿病号服。"},
		{Name: "周临", Prompt: "成年男性，身材修长，气质冷峻。"},
	}
	contract := buildH3DirectorContract(source, H3DirectorPreset{Key: "h3-director-normal", Revision: 1}, assets)
	if !strings.Contains(contract.SystemPrompt, "canonical_name 必须优先使用已有人物资产的精确 name") {
		t.Fatalf("director contract does not enforce stable asset names: %s", contract.SystemPrompt)
	}
	if !strings.Contains(contract.UserPrompt, `"name":"江淮雪"`) || !strings.Contains(contract.UserPrompt, `"name":"周临"`) {
		t.Fatalf("director contract lost existing character assets: %s", contract.UserPrompt)
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
