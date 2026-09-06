package batchfactoryv11

import (
	"strings"
	"testing"
)

func TestDirectorContractUsesServerPromptBundleAndContentWindow(t *testing.T) {
	bundle := PromptBundle{
		Script: Prompt{ID: "script-test", Kind: "script", Content: "脚本规则：必须保留原文冲突。"},
		Asset:  Prompt{ID: "asset-test", Kind: "asset", Content: "资产规则：人物、场景、道具分别给出稳定提示词。"},
		Video:  Prompt{ID: "video-test", Kind: "video", Content: "视频规则：每个片段给出可拍动作和镜头。"},
	}
	contract, err := BuildDirectorContract(Book{ID: "b1", Title: "测试", ContentPreview: "前五行", SourceText: "全文"}, HookRevision{}, DirectorSnapshot{Mode: "original", MaxVideoDuration: 15, AspectRatio: "9:16"}, bundle)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"脚本规则", "资产规则", "视频规则", "前五行"} {
		if !strings.Contains(contract.SystemPrompt+contract.UserPrompt, want) {
			t.Fatalf("missing %q", want)
		}
	}
	if strings.Contains(contract.SystemPrompt+contract.UserPrompt, "全文") {
		t.Fatal("director contract used the full source instead of content preview")
	}
}

func TestPromptCatalogListsChineseAdminLabelsByKind(t *testing.T) {
	records := SystemPromptCatalog()
	for _, kind := range []string{"hook", "script", "asset", "video"} {
		found := false
		for _, record := range records {
			if record.Kind == kind && strings.TrimSpace(record.Name) != "" && strings.TrimSpace(record.Content) != "" {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing kind %s", kind)
		}
	}
}
