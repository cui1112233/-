package batchfactoryv11

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestAutomaticAssetIDsForH3SegmentUsesStructuredCharacterAndSceneBindings(t *testing.T) {
	document := mustH3DirectorFixture(t)
	segment := H3VideoSegment{SourceSlices: []H3SourceSlice{{SourceIndex: 1, SourceKey: "L001"}}}
	assets := map[string]string{
		"character\x00我": "asset-character-me",
		"scene\x00豪宅玄关":  "asset-scene-entry",
	}
	want := []string{"asset-character-me", "asset-scene-entry"}
	if got := automaticAssetIDsForH3Segment(document, segment, assets); !reflect.DeepEqual(got, want) {
		t.Fatalf("automatic H3 assets = %#v, want %#v", got, want)
	}
}

func TestNormalizeH3CharacterAssetPromptRejectsSimplifiedOneLineDescription(t *testing.T) {
	_, err := normalizeH3AssetPrompt(json.RawMessage(`{"prompt":"年轻女性，黑色长发，穿病号服。"}`), "character")
	if err == nil || !strings.Contains(err.Error(), "人物提示词过于简化") {
		t.Fatalf("short H3 character prompt must be rejected, err=%v", err)
	}
}

func TestBuildH3CharacterAssetPromptRequiresProductionReadyVisualDefinition(t *testing.T) {
	contract, err := BuildH3AssetPromptContract(Book{ID: "book-1", Title: "淮雪", SourceText: "江淮雪在病房醒来。"}, DirectorAssets{}, "character", NamedPrompt{Name: "江淮雪", Prompt: "年轻女性"}, PresetSnapshot{Body: "H3 CHARACTER"})
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"脸型与五官", "发型与发色", "体型与年龄感", "服装分层", "材质与颜色", "视觉识别点", "不少于 120 个中文字"} {
		if !strings.Contains(contract.SystemPrompt, required) {
			t.Fatalf("H3 character contract missing %q: %s", required, contract.SystemPrompt)
		}
	}
}

func TestAutomaticAssetIDsForH3SegmentIncludesMicroShotCharactersAndAliases(t *testing.T) {
	document := H3DirectorDocument{
		CharacterRoster: []H3Character{
			{SlotID: "C001", CanonicalName: "江小姐", Aliases: []string{"江淮雪"}},
			{SlotID: "C002", CanonicalName: "护士"},
			{SlotID: "C003", CanonicalName: "江小姐的老公", Aliases: []string{"周临"}},
		},
		DirectorCards: []H3DirectorCard{{
			SourceIndex:      1,
			SourceKey:        "L001",
			CharacterSlotIDs: []string{"C001", "C002"},
			MicroShots: []H3MicroShot{{
				MicroShotKey:     "L001-M2",
				CharacterSlotIDs: []string{"C001", "C002", "C003"},
			}},
		}},
	}
	segment := H3VideoSegment{SourceSlices: []H3SourceSlice{{SourceIndex: 1, SourceKey: "L001"}}}
	assets := map[string]string{
		"character\x00江淮雪": "asset-jiang-huaixue",
		"character\x00护士":  "asset-nurse",
		"character\x00周临":  "asset-husband",
	}
	want := []string{"asset-husband", "asset-jiang-huaixue", "asset-nurse"}
	if got := automaticAssetIDsForH3Segment(document, segment, assets); !reflect.DeepEqual(got, want) {
		t.Fatalf("automatic H3 assets = %#v, want %#v", got, want)
	}
}
