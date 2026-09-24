package batchfactoryv11

import (
	"encoding/json"
	"testing"
)

func TestEffectiveVideoSettingsKeepImageRatioIndependent(t *testing.T) {
	legacySquareImage := SettingsPatch{"aspectRatio": json.RawMessage(`"1:1"`)}
	if got := EffectiveVideoAspectRatio(legacySquareImage); got != "9:16" {
		t.Fatalf("legacy square image ratio must fall back to vertical video, got %q", got)
	}
	if got := EffectiveImageAspectRatio(legacySquareImage); got != "1:1" {
		t.Fatalf("legacy square image ratio = %q, want 1:1", got)
	}
	if got := EffectiveVideoResolution(legacySquareImage); got != "720p" {
		t.Fatalf("default video resolution = %q, want 720p", got)
	}

	separate := SettingsPatch{
		"imageAspectRatio": json.RawMessage(`"1:1"`),
		"videoAspectRatio": json.RawMessage(`"16:9"`),
		"videoResolution":  json.RawMessage(`"1080p"`),
	}
	if got := EffectiveVideoAspectRatio(separate); got != "16:9" {
		t.Fatalf("video ratio = %q, want 16:9", got)
	}
	if got := EffectiveImageAspectRatio(separate); got != "1:1" {
		t.Fatalf("image ratio = %q, want 1:1", got)
	}
	if got := EffectiveVideoResolution(separate); got != "1080p" {
		t.Fatalf("video resolution = %q, want 1080p", got)
	}
}
