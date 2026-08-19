package httpapi

import (
	"strings"
	"testing"

	"qiantie/backend/internal/shuihuo/domain"
)

func TestComposeStoryboardImagePromptIncludesOnlyBoundVisualAssets(t *testing.T) {
	prompt := composeStoryboardImagePrompt("雨夜车站，林鸢回头", []domain.Asset{
		{Name: "林鸢", Category: "character", Prompt: "黑色长发，米白风衣"},
		{Name: "雨夜车站", Category: "scene", Prompt: "霓虹湿地面，冷色调"},
		{Name: "旁白音色", Category: "voice", Prompt: "不得进入生图提示词"},
	})
	for _, want := range []string{"雨夜车站，林鸢回头", "林鸢：黑色长发，米白风衣", "雨夜车站：霓虹湿地面，冷色调"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt = %q, missing %q", prompt, want)
		}
	}
	if strings.Contains(prompt, "旁白音色") {
		t.Fatalf("voice asset leaked into image prompt: %q", prompt)
	}
}
