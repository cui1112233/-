package httpapi

import (
	"testing"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/providers"
)

func TestNormalizeAssetPlanSceneContinuityCarriesSceneUntilSwitch(t *testing.T) {
	plan := providers.AssetPlan{
		Assets: []providers.AssetPlanAsset{
			{Key: "character_hero", AssetCandidate: providers.AssetCandidate{Category: "character", Name: "主角", Prompt: "主角设定"}},
			{Key: "scene_room", AssetCandidate: providers.AssetCandidate{Category: "scene", Name: "卧室", Prompt: "卧室设定"}},
			{Key: "scene_kitchen", AssetCandidate: providers.AssetCandidate{Category: "scene", Name: "厨房", Prompt: "厨房设定"}},
		},
		Bindings: []providers.AssetPlanBinding{
			{SegmentID: 11, SceneMode: "start", AssetKeys: []string{"character_hero", "scene_room"}},
			{SegmentID: 12, SceneMode: "continue", AssetKeys: []string{"character_hero", "scene_kitchen"}},
			{SegmentID: 13, SceneMode: "switch", AssetKeys: []string{"scene_kitchen"}},
			{SegmentID: 14, SceneMode: "continue", AssetKeys: nil},
		},
	}
	segments := []domain.Segment{{ID: 11, OrderIndex: 1}, {ID: 12, OrderIndex: 2}, {ID: 13, OrderIndex: 3}, {ID: 14, OrderIndex: 4}}

	if err := normalizeAssetPlanSceneContinuity(&plan, segments); err != nil {
		t.Fatalf("normalizeAssetPlanSceneContinuity() error = %v", err)
	}
	wantSceneKeys := [][]string{{"scene_room"}, {"scene_room"}, {"scene_kitchen"}, {"scene_kitchen"}}
	for index, binding := range plan.Bindings {
		got := make([]string, 0, 1)
		for _, key := range binding.AssetKeys {
			if key == "scene_room" || key == "scene_kitchen" {
				got = append(got, key)
			}
		}
		if len(got) != len(wantSceneKeys[index]) || got[0] != wantSceneKeys[index][0] {
			t.Fatalf("segment %d scene keys = %#v, want %#v", binding.SegmentID, got, wantSceneKeys[index])
		}
	}
}
