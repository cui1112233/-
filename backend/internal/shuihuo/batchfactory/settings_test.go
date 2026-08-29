package batchfactory

import (
	"reflect"
	"testing"
)

func TestNormalizeSettingsPreservesExplicitFalseAndSnapshotFields(t *testing.T) {
	got := NormalizeSettings(Settings{
		"aspectRatio":          "16:9",
		"prefixEnabled":       false,
		"injectCharacterPrompt": false,
		"injectScenePrompt":     true,
		"injectPropPrompt":      false,
		"qualityEnabled":      false,
		"restrictionEnabled":  true,
		"negativeEnabled":     false,
		"subtitlePolicy":      "allow",
		"systemConfigRevision": "abc123",
		"systemConfigLabel":    "配置 v6",
		"systemConfigSyncedAt": "2026-08-29T08:00:00.000Z",
		"systemPresetVersions": map[string]any{
			"batch-original-director": float64(3),
			"commercial-dynamic-storyboard": float64(2),
		},
	}, nil)

	checks := map[string]any{
		"aspectRatio":           "16:9",
		"prefixEnabled":        false,
		"injectCharacterPrompt": false,
		"injectScenePrompt":     true,
		"injectPropPrompt":      false,
		"qualityEnabled":       false,
		"restrictionEnabled":   true,
		"negativeEnabled":      false,
		"subtitlePolicy":       "allow",
		"systemConfigRevision": "abc123",
		"systemConfigLabel":    "配置 v6",
	}
	for key, want := range checks {
		if !reflect.DeepEqual(got[key], want) {
			t.Fatalf("%s = %#v, want %#v; settings=%#v", key, got[key], want, got)
		}
	}

	versions, ok := got["systemPresetVersions"].(map[string]int)
	if !ok {
		t.Fatalf("systemPresetVersions type = %T, want map[string]int; settings=%#v", got["systemPresetVersions"], got)
	}
	if !reflect.DeepEqual(versions, map[string]int{
		"batch-original-director":          3,
		"commercial-dynamic-storyboard": 2,
	}) {
		t.Fatalf("systemPresetVersions = %#v", versions)
	}
}

func TestNormalizeSettingsAppliesCurrentDefaults(t *testing.T) {
	got := NormalizeSettings(nil, nil)
	want := map[string]any{
		"maxVideoDuration":       10,
		"fixedSingleVideo":       false,
		"exactDuration":          nil,
		"aspectRatio":            "9:16",
		"prefixMode":             "auto",
		"prefixEnabled":          true,
		"scriptPromptPresetId":   "standard-short-drama",
		"assetPromptPresetId":    "standard-asset-extraction",
		"injectCharacterPrompt":  true,
		"injectScenePrompt":      true,
		"injectPropPrompt":       true,
		"qualityEnabled":         true,
		"restrictionEnabled":     true,
		"negativeEnabled":        true,
		"subtitlePolicy":         "forbid-auto-dialogue-subtitle",
	}
	for key, expected := range want {
		if !reflect.DeepEqual(got[key], expected) {
			t.Fatalf("%s = %#v, want %#v; settings=%#v", key, got[key], expected, got)
		}
	}
}

func TestNormalizeSettingsFixedSingleVideoUsesModelMaximum(t *testing.T) {
	got := NormalizeSettings(Settings{
		"maxVideoDuration": 15,
		"fixedSingleVideo": true,
	}, nil)
	if got["maxVideoDuration"] != 15 || got["exactDuration"] != 15 {
		t.Fatalf("settings = %#v, want maxVideoDuration/exactDuration = 15", got)
	}
}

func TestNormalizeSparseOverrideOnlyStoresChangedAllowedFields(t *testing.T) {
	got := NormalizeSparseOverride(Settings{
		"quality":               "单书画质",
		"injectCharacterPrompt": false,
		"unknown":               "drop-me",
	}, nil, nil)
	want := Settings{
		"quality":               "单书画质",
		"injectCharacterPrompt": false,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("override = %#v, want %#v", got, want)
	}
}

func TestNormalizeSparseOverrideRestoreInheritanceDeletesKeys(t *testing.T) {
	got := NormalizeSparseOverride(Settings{
		"restriction": "新的限制",
	}, Settings{
		"quality":         "单书画质",
		"restriction":     "旧限制",
		"negativeEnabled": false,
	}, []string{"quality", "negativeEnabled"})
	want := Settings{"restriction": "新的限制"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("override = %#v, want %#v", got, want)
	}
}

func TestNormalizeSparseOverridePreservesEmptyTextAndFalse(t *testing.T) {
	got := NormalizeSparseOverride(Settings{
		"aspectRatio":   "16:9",
		"quality":       "",
		"qualityEnabled": false,
		"subtitlePolicy": "allow",
	}, nil, nil)
	want := Settings{
		"aspectRatio":   "16:9",
		"quality":       "",
		"qualityEnabled": false,
		"subtitlePolicy": "allow",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("override = %#v, want %#v", got, want)
	}
}
