package httpapi

import (
	"strings"
	"testing"

	"qiantie/backend/internal/shuihuo/domain"
)

func TestComposeConfiguredPromptUsesPrefixBaseAndSuffixOnly(t *testing.T) {
	prompt := composeConfiguredPrompt("电影感光影", "雨夜车站，林鸢回头", "无文字，无水印")
	if want := "电影感光影\n\n雨夜车站，林鸢回头\n\n无文字，无水印"; prompt != want {
		t.Fatalf("prompt = %q, want %q", prompt, want)
	}
}

func TestComposeTextToVideoPromptOrdersBoundAssetsByCategory(t *testing.T) {
	prompt := composeTextToVideoPrompt("视频前缀", []domain.Asset{
		{Name: "旧道具", Category: "prop", Prompt: "铜制怀表"},
		{Name: "场景", Category: "scene", Prompt: "雨夜站台"},
		{Name: "角色", Category: "character", Prompt: "米白风衣的林鸢"},
		{Name: "音色", Category: "voice", Prompt: "不得进入视频提示词"},
	}, "镜头缓慢推进", "视频后缀")
	want := "视频前缀\n\n米白风衣的林鸢\n\n雨夜站台\n\n铜制怀表\n\n镜头缓慢推进\n\n视频后缀"
	if prompt != want {
		t.Fatalf("prompt = %q, want %q", prompt, want)
	}
	if strings.Contains(prompt, "不得进入") {
		t.Fatalf("voice asset leaked into video prompt: %q", prompt)
	}
}
