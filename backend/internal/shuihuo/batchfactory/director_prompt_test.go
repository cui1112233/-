package batchfactory

import (
	"strings"
	"testing"
)

func directorPromptPresetHistory() []PresetVersion {
	return []PresetVersion{
		{ID: "batch-hook-adaptation", Module: "batch-factory", Name: "爆款开头", Version: 1, Status: "archived", Body: "HOOK V1", PublishedAt: "2026-08-01T00:00:00Z"},
		{ID: "batch-hook-adaptation", Module: "batch-factory", Name: "爆款开头", Version: 2, Status: "published", Body: "HOOK V2", PublishedAt: "2026-08-02T00:00:00Z"},
		{ID: "batch-original-director", Module: "batch-factory", Name: "原文导演", Version: 1, Status: "archived", Body: "DIRECTOR V1", PublishedAt: "2026-08-01T00:00:00Z"},
		{ID: "batch-original-director", Module: "batch-factory", Name: "原文导演", Version: 2, Status: "published", Body: "DIRECTOR V2", PublishedAt: "2026-08-02T00:00:00Z"},
		{ID: "batch-viral-director", Module: "batch-factory", Name: "爆款导演", Version: 1, Status: "published", Body: "VIRAL DIRECTOR V1", PublishedAt: "2026-08-01T00:00:00Z"},
		{ID: "standard-short-drama", Module: "batch-factory", Name: "短剧剧本", Version: 1, Status: "archived", Body: "SCRIPT V1", PublishedAt: "2026-08-01T00:00:00Z"},
		{ID: "standard-short-drama", Module: "batch-factory", Name: "短剧剧本", Version: 2, Status: "published", Body: "SCRIPT V2", PublishedAt: "2026-08-02T00:00:00Z"},
		{ID: "standard-asset-extraction", Module: "batch-factory", Name: "资产提取", Version: 1, Status: "published", Body: "ASSET V1", PublishedAt: "2026-08-01T00:00:00Z"},
	}
}

func TestDirectorPromptContractUsesFrozenPresetVersions(t *testing.T) {
	contract, err := BuildDirectorPromptContract(DirectorPromptRequest{
		Mode:                "original",
		SourceTaskID:        "174263",
		BookID:              "2074141710842647315",
		SourceText:          "林晚推门而入。",
		Style:               "现代都市",
		Synopsis:            "家族冲突",
		ScriptPromptPresetID: "standard-short-drama",
		AssetPromptPresetID:  "standard-asset-extraction",
		VideoModel: DirectorVideoModelSnapshot{ID: 18, VersionID: 42, Name: "Seedance 2.0", MaxVideoDuration: 15},
		MaxVideoDuration:    15,
		FixedSingleVideo:    false,
		AspectRatio:         "9:16",
		SystemPresetVersions: map[string]int{
			"batch-original-director": 1,
			"standard-short-drama":    1,
			"standard-asset-extraction": 1,
		},
		Presets: directorPromptPresetHistory(),
	})
	if err != nil {
		t.Fatalf("BuildDirectorPromptContract returned error: %v", err)
	}
	if !strings.Contains(contract.SystemPrompt, "DIRECTOR V1") || strings.Contains(contract.SystemPrompt, "DIRECTOR V2") {
		t.Fatalf("director preset was not frozen: %s", contract.SystemPrompt)
	}
	if !strings.Contains(contract.SystemPrompt, "SCRIPT V1") || strings.Contains(contract.SystemPrompt, "SCRIPT V2") {
		t.Fatalf("script preset was not frozen: %s", contract.SystemPrompt)
	}
	if !strings.Contains(contract.SystemPrompt, "ASSET V1") {
		t.Fatalf("asset preset missing: %s", contract.SystemPrompt)
	}
	if !strings.Contains(contract.SystemPrompt, "1-15") || !strings.Contains(contract.SystemPrompt, "general_anime") {
		t.Fatalf("duration/prefix contract missing: %s", contract.SystemPrompt)
	}
	if !strings.Contains(contract.UserPrompt, `"source_task_id": "174263"`) || !strings.Contains(contract.UserPrompt, `"book_id": "2074141710842647315"`) {
		t.Fatalf("source identity missing: %s", contract.UserPrompt)
	}
	if contract.PromptVersions["batch-original-director"].Version != 1 || contract.PromptVersions["scriptPrompt"].Version != 1 {
		t.Fatalf("unexpected prompt versions: %#v", contract.PromptVersions)
	}
	if contract.Temperature != 0.35 || contract.MaxTokens != 18000 {
		t.Fatalf("unexpected model settings: temp=%v max=%d", contract.Temperature, contract.MaxTokens)
	}
	if contract.Normalization.MaxVideoDuration != 15 || contract.Normalization.AspectRatio != "9:16" {
		t.Fatalf("unexpected normalization settings: %#v", contract.Normalization)
	}
}

func TestDirectorPromptContractAppliesPersonalPromptOverrides(t *testing.T) {
	contract, err := BuildDirectorPromptContract(DirectorPromptRequest{
		Mode:                 "viral",
		SourceText:           "原始正文",
		ApprovedHookScript:   "审核后的爆款开头",
		ScriptPromptPresetID: "standard-short-drama",
		AssetPromptPresetID:  "standard-asset-extraction",
		MaxVideoDuration:     15,
		FixedSingleVideo:     true,
		ExactDuration:        15,
		AspectRatio:          "16:9",
		Presets:              directorPromptPresetHistory(),
		PersonalPromptOverrides: map[string]PersonalPromptOverride{
			"standard-short-drama": {Body: "PERSONAL SCRIPT", Version: 7},
		},
	})
	if err != nil {
		t.Fatalf("BuildDirectorPromptContract returned error: %v", err)
	}
	if !strings.Contains(contract.SystemPrompt, "VIRAL DIRECTOR V1") || !strings.Contains(contract.SystemPrompt, "PERSONAL SCRIPT") {
		t.Fatalf("viral/personal prompt missing: %s", contract.SystemPrompt)
	}
	if !strings.Contains(contract.SystemPrompt, "严格等于 15") || !strings.Contains(contract.UserPrompt, "审核后的爆款开头") {
		t.Fatalf("fixed single or approved hook missing: %s / %s", contract.SystemPrompt, contract.UserPrompt)
	}
	if contract.PromptVersions["scriptPrompt"].Version != 7 || contract.PromptVersions["scriptPrompt"].Source != "personal" {
		t.Fatalf("personal prompt metadata missing: %#v", contract.PromptVersions["scriptPrompt"])
	}
	if contract.Temperature != 0.65 {
		t.Fatalf("unexpected viral temperature: %v", contract.Temperature)
	}
}

func TestHookPromptContractUsesFrozenHookPreset(t *testing.T) {
	contract, err := BuildHookPromptContract(HookPromptRequest{
		SourceText: "小说正文",
		Style:      "都市",
		Synopsis:   "冲突",
		SystemPresetVersions: map[string]int{
			"batch-hook-adaptation": 1,
		},
		Presets: directorPromptPresetHistory(),
	})
	if err != nil {
		t.Fatalf("BuildHookPromptContract returned error: %v", err)
	}
	if contract.SystemPrompt != "HOOK V1" || !strings.Contains(contract.UserPrompt, "小说正文") {
		t.Fatalf("unexpected hook contract: %#v", contract)
	}
	if contract.PromptVersions["hook"].Version != 1 || contract.Temperature != 0.75 || contract.MaxTokens != 5000 {
		t.Fatalf("unexpected hook metadata: %#v", contract)
	}
}
