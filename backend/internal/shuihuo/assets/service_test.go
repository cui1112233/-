package assets

import (
	"testing"

	"qiantie/backend/internal/shuihuo/domain"
)

func TestAnalysisSkipsLockedAssetAndPrompt(t *testing.T) {
	existing := domain.Asset{Name: "林晚", Prompt: "用户设定", ManuallyEdited: true}
	merged := MergeAssetCandidates([]domain.Asset{existing}, []domain.Asset{{Name: "林晚", Prompt: "AI 设定"}}, false)
	if merged[0].Prompt != "用户设定" {
		t.Fatalf("manual asset overwritten: %#v", merged[0])
	}
}

func TestExplicitOverwriteReplacesLockedAsset(t *testing.T) {
	merged := MergeAssetCandidates([]domain.Asset{{Name: "林晚", Prompt: "用户设定", ManuallyEdited: true}}, []domain.Asset{{Name: "林晚", Prompt: "AI 设定"}}, true)
	if merged[0].Prompt != "AI 设定" {
		t.Fatalf("manual asset not overwritten: %#v", merged[0])
	}
}

func TestApplyPrefixSuffix(t *testing.T) {
	if got := ApplyPrefixSuffix("主体", "前缀", "后缀"); got != "前缀\n主体\n后缀" {
		t.Fatalf("got %q", got)
	}
}

func TestNormalizeCategoryUsesKnownProductionAssetTypes(t *testing.T) {
	if got, err := NormalizeCategory(" scene "); err != nil || got != "scene" {
		t.Fatalf("NormalizeCategory() = %q, %v", got, err)
	}
	if _, err := NormalizeCategory("costume"); err == nil {
		t.Fatal("NormalizeCategory() accepted an unsupported category")
	}
}
