package batchfactoryv11

import (
	"strings"
	"testing"
)

func TestParseOpeningVariants(t *testing.T) {
	raw := strings.Join([]string{
		"===VARIANT 1===",
		"时长：10秒",
		"画面故事脚本：摔东西争吵的开场，茶盏砸落大理石地面碎裂。",
		"",
		"===VARIANT 2===",
		"时长：10秒",
		"画面故事脚本：雨夜推门而入，两人对视沉默后爆发争吵。",
	}, "\n")
	variants := parseOpeningVariants(raw, 15, 10, 2)
	if len(variants) != 2 {
		t.Fatalf("variants = %d, want 2", len(variants))
	}
	if variants[0].Index != 1 || variants[0].Status != "success" || variants[0].DurationSec != 10 {
		t.Fatalf("variant[0] = %#v", variants[0])
	}
	if !strings.Contains(variants[1].Prompt, "雨夜推门而入") {
		t.Fatalf("variant[1].prompt = %q", variants[1].Prompt)
	}
	if variants[0].Label != "分镜一 | 换开头1" {
		t.Fatalf("label = %q", variants[0].Label)
	}
}

func TestParseOpeningVariantsAcceptsInlineMarkerAndDuration(t *testing.T) {
	variants := parseOpeningVariants("===VARIANT 1=== 时长：10秒\n开头正文", 15, 10, 1)
	if len(variants) != 1 {
		t.Fatalf("variants = %d, want 1", len(variants))
	}
	if variants[0].Status != "success" || variants[0].DurationSec != 10 || variants[0].Prompt != "开头正文" {
		t.Fatalf("variant = %#v", variants[0])
	}
}

func TestParseOpeningVariantsAcceptsCommonModelMarkerDrift(t *testing.T) {
	raw := strings.Join([]string{
		"### VARIANT 1",
		"时长：10秒",
		"变体一正文",
		"",
		"**变体 2：**",
		"变体二正文",
		"",
		"=== 换开头 3 ===",
		"变体三正文",
	}, "\n")
	variants := parseOpeningVariants(raw, 15, 10, 3)
	for index, variant := range variants {
		if variant.Status != "success" {
			t.Fatalf("variant[%d] = %#v, want success", index, variant)
		}
	}
	if !strings.Contains(variants[1].Prompt, "变体二正文") {
		t.Fatalf("variant[1].prompt = %q", variants[1].Prompt)
	}
}

func TestParseOpeningVariantsFillsMissingAsFailed(t *testing.T) {
	raw := "===VARIANT 1===\n时长：10秒\n正文"
	variants := parseOpeningVariants(raw, 15, 10, 3)
	if len(variants) != 3 {
		t.Fatalf("variants = %d, want 3", len(variants))
	}
	if variants[0].Status != "success" {
		t.Fatalf("variant[0].status = %q", variants[0].Status)
	}
	for _, variant := range variants[1:] {
		if variant.Status != "failed" || variant.Prompt != "" {
			t.Fatalf("missing variant = %#v", variant)
		}
	}
}

func TestParseOpeningVariantsRejectsBadDuration(t *testing.T) {
	raw := "===VARIANT 1===\n时长：99秒\n正文"
	variants := parseOpeningVariants(raw, 15, 10, 1)
	if variants[0].Status != "failed" {
		t.Fatalf("expected failed variant, got %#v", variants[0])
	}
}

func TestParseOpeningVariantsInheritsOriginalDurationWhenModelOmitsDurationLine(t *testing.T) {
	raw := "===VARIANT 1===\n**换开头画面**\n茶盏砸落大理石地面碎裂，争吵爆发。"
	variants := parseOpeningVariants(raw, 15, 10, 1)
	if len(variants) != 1 {
		t.Fatalf("variants = %d, want 1", len(variants))
	}
	if variants[0].Status != "success" || variants[0].DurationSec != 10 {
		t.Fatalf("variant = %#v", variants[0])
	}
	if !strings.Contains(variants[0].Prompt, "茶盏砸落") {
		t.Fatalf("variant prompt = %q", variants[0].Prompt)
	}
}
