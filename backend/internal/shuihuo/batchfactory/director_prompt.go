package batchfactory

import (
	"encoding/json"
	"fmt"
	"strings"
)

var DirectorPrefixKeys = []string{
	"general_anime",
	"modern_conflict",
	"ancient_drama",
	"xuanhuan_action",
	"suspense",
	"era_drama",
}

const directorSchema = `只输出合法 JSON，结构必须为：
{
  "characters": [{"name":"人物名","prompt":"完整人物提示词"}],
  "scenes": [{"name":"场景名","prompt":"完整场景提示词"}],
  "props": [{"name":"道具名","prompt":"完整道具视觉提示词"}],
  "storyboard": [
    {
      "id": 1,
      "scene_id": 1,
      "duration_sec": 13,
      "characters": ["人物名"],
      "props": ["道具名"],
      "scene": "场景名",
      "prefix_key": "general_anime",
      "shots": [
        {"start_sec":0,"end_sec":3,"shot_type":"中景","camera":"缓慢推轨","description":"完整画面、动作、表情、光影、情绪、对白与音效描述"}
      ],
      "video_desc": "按 shots 顺序组织的完整中文分镜描述词"
    }
  ],
  "source_coverage": {
    "source_complete": true,
    "source_end_marker": "本次最后覆盖的原文末尾短句；无法提供则空字符串",
    "has_remaining_source": false
  }
}

强制要求：
- 最终 duration_sec、start_sec、end_sec 全部只能是整数。
- shots 必须从 0 秒开始连续衔接，不能留空或重叠，最后 end_sec 必须严格等于 duration_sec。
- characters/scene/props 必须引用同一 JSON 顶层信息库中的名称。
- video_desc 不能省略 shots 已表达的关键剧情和原文对白。`

type PersonalPromptOverride struct {
	Body    string `json:"body"`
	Version int    `json:"version"`
}

type DirectorVideoModelSnapshot struct {
	ID               int64  `json:"id"`
	VersionID        int64  `json:"versionId"`
	Name             string `json:"name"`
	MaxVideoDuration int    `json:"maxVideoDuration"`
}

type PromptVersionMeta struct {
	ID      string `json:"id"`
	Name    string `json:"name,omitempty"`
	Version int    `json:"version"`
	Source  string `json:"source,omitempty"`
}

type PromptContract struct {
	SystemPrompt   string                       `json:"systemPrompt"`
	UserPrompt     string                       `json:"userPrompt"`
	Temperature    float64                      `json:"temperature"`
	MaxTokens      int                          `json:"maxTokens"`
	PromptVersions map[string]PromptVersionMeta `json:"promptVersions"`
	Normalization  DirectorSettings             `json:"normalization"`
}

type HookPromptRequest struct {
	SourceText           string         `json:"sourceText"`
	Style                string         `json:"style"`
	Synopsis             string         `json:"synopsis"`
	SystemPresetVersions map[string]int `json:"systemPresetVersions"`
	Presets              []PresetVersion `json:"presets"`
}

type DirectorPromptRequest struct {
	Mode                    string                            `json:"mode"`
	SourceTaskID            string                            `json:"sourceTaskId"`
	BookID                  string                            `json:"bookId"`
	SourceText              string                            `json:"sourceText"`
	ApprovedHookScript      string                            `json:"approvedHookScript"`
	Style                   string                            `json:"style"`
	Synopsis                string                            `json:"synopsis"`
	ScriptPromptPresetID    string                            `json:"scriptPromptPresetId"`
	AssetPromptPresetID     string                            `json:"assetPromptPresetId"`
	VideoModel              DirectorVideoModelSnapshot        `json:"videoModel"`
	MaxVideoDuration        int                               `json:"maxVideoDuration"`
	FixedSingleVideo        bool                              `json:"fixedSingleVideo"`
	ExactDuration           int                               `json:"exactDuration"`
	AspectRatio             string                            `json:"aspectRatio"`
	SystemPresetVersions    map[string]int                    `json:"systemPresetVersions"`
	PersonalPromptOverrides map[string]PersonalPromptOverride `json:"personalPromptOverrides"`
	Presets                 []PresetVersion                   `json:"presets"`
}

func frozenPresetVersion(pins map[string]int, id string) int {
	if pins == nil {
		return 0
	}
	if version := pins[id]; version > 0 {
		return version
	}
	return 0
}

func requiredDirectorPreset(rows []PresetVersion, pins map[string]int, id string) (PresetVersion, error) {
	preset, ok := ResolveVersionedPreset(rows, id, frozenPresetVersion(pins, id))
	if !ok {
		return PresetVersion{}, fmt.Errorf("批量工厂 preset 不存在：%s", id)
	}
	return preset, nil
}

func promptMeta(preset PresetVersion, source string) PromptVersionMeta {
	if source == "" {
		source = "system"
	}
	return PromptVersionMeta{
		ID:      preset.ID,
		Name:    preset.Name,
		Version: preset.Version,
		Source:  source,
	}
}

func applyPersonalDirectorPrompt(base PresetVersion, overrides map[string]PersonalPromptOverride) (PresetVersion, string) {
	override, ok := overrides[base.ID]
	if !ok || strings.TrimSpace(override.Body) == "" {
		return base, "system"
	}
	base.Body = strings.TrimSpace(override.Body)
	if override.Version > 0 {
		base.Version = override.Version
	}
	return base, "personal"
}

func BuildHookPromptContract(req HookPromptRequest) (PromptContract, error) {
	const id = "batch-hook-adaptation"
	preset, err := requiredDirectorPreset(req.Presets, req.SystemPresetVersions, id)
	if err != nil {
		return PromptContract{}, err
	}
	payload := map[string]any{
		"source_text": strings.TrimSpace(req.SourceText),
		"style":       strings.TrimSpace(req.Style),
		"synopsis":    strings.TrimSpace(req.Synopsis),
	}
	userPrompt, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return PromptContract{}, err
	}
	return PromptContract{
		SystemPrompt: strings.TrimSpace(preset.Body),
		UserPrompt:   string(userPrompt),
		Temperature:  0.75,
		MaxTokens:    5000,
		PromptVersions: map[string]PromptVersionMeta{
			"hook": promptMeta(preset, "system"),
		},
	}, nil
}

func BuildDirectorPromptContract(req DirectorPromptRequest) (PromptContract, error) {
	mode := strings.TrimSpace(req.Mode)
	if mode != "original" && mode != "viral" {
		return PromptContract{}, fmt.Errorf("导演模式无效")
	}
	if req.MaxVideoDuration < 1 || req.MaxVideoDuration > 60 {
		return PromptContract{}, fmt.Errorf("maxVideoDuration 超出允许范围")
	}
	if req.FixedSingleVideo && (req.ExactDuration < 1 || req.ExactDuration > req.MaxVideoDuration) {
		return PromptContract{}, fmt.Errorf("exactDuration 必须位于模型最大时长范围内")
	}
	aspectRatio := strings.TrimSpace(req.AspectRatio)
	if aspectRatio == "" {
		aspectRatio = "9:16"
	}
	if aspectRatio != "9:16" && aspectRatio != "16:9" {
		return PromptContract{}, fmt.Errorf("aspectRatio 仅支持 9:16 或 16:9")
	}
	if mode == "viral" && strings.TrimSpace(req.ApprovedHookScript) == "" {
		return PromptContract{}, fmt.Errorf("爆款模式必须先审核通过开头文案")
	}

	directorID := "batch-original-director"
	if mode == "viral" {
		directorID = "batch-viral-director"
	}
	scriptID := strings.TrimSpace(req.ScriptPromptPresetID)
	if scriptID == "" {
		scriptID = "standard-short-drama"
	}
	assetID := strings.TrimSpace(req.AssetPromptPresetID)
	if assetID == "" {
		assetID = "standard-asset-extraction"
	}

	directorPreset, err := requiredDirectorPreset(req.Presets, req.SystemPresetVersions, directorID)
	if err != nil {
		return PromptContract{}, err
	}
	scriptPreset, err := requiredDirectorPreset(req.Presets, req.SystemPresetVersions, scriptID)
	if err != nil {
		return PromptContract{}, err
	}
	assetPreset, err := requiredDirectorPreset(req.Presets, req.SystemPresetVersions, assetID)
	if err != nil {
		return PromptContract{}, err
	}
	scriptPreset, scriptSource := applyPersonalDirectorPrompt(scriptPreset, req.PersonalPromptOverrides)
	assetPreset, assetSource := applyPersonalDirectorPrompt(assetPreset, req.PersonalPromptOverrides)

	durationRule := fmt.Sprintf("固定单 VIDEO 未开启：当前绑定视频模型单次生成最大支持 %d 秒。请先完整理解内容，根据剧情节点、动作完整性、视觉连续性和节奏，将整段内容自然拆成一个或多个 VIDEO。每个 VIDEO 的实际生成时长必须为 1-%d 之间的整数，不要求用满 %d 秒。不要为了凑时长加入无意义停顿，也不要用简单固定长度机械切分。", req.MaxVideoDuration, req.MaxVideoDuration, req.MaxVideoDuration)
	if req.FixedSingleVideo {
		durationRule = fmt.Sprintf("固定单 VIDEO 已开启：只允许输出 1 个 storyboard；duration_sec 必须严格等于 %d。输入再长也不要输出第二个 storyboard。只能从开头选择能在 %d 秒内完整承载的连续内容，不得从一句对白或完整动作中间截断。后续内容标记为 has_remaining_source=true。", req.ExactDuration, req.ExactDuration)
	}
	prefixLines := make([]string, 0, len(DirectorPrefixKeys))
	for _, key := range DirectorPrefixKeys {
		prefixLines = append(prefixLines, "- "+key)
	}
	prefixPrompt := "可用视频前缀类型 key 只能从以下列表选择：\n" + strings.Join(prefixLines, "\n") + "\n根据每个视频单元自身题材和情绪选择最匹配的 key；不确定时使用 general_anime。"

	systemParts := []string{
		strings.TrimSpace(directorPreset.Body),
		fmt.Sprintf("【当前剧本提示词：%s】\n%s", scriptPreset.Name, strings.TrimSpace(scriptPreset.Body)),
		fmt.Sprintf("【当前人物场景提示词：%s】\n%s", assetPreset.Name, strings.TrimSpace(assetPreset.Body)),
		prefixPrompt,
		durationRule,
		directorSchema,
	}

	currentContent := strings.TrimSpace(req.SourceText)
	if mode == "viral" {
		currentContent = strings.TrimSpace(req.ApprovedHookScript)
	}
	userPayload := struct {
		Mode                   string                     `json:"mode"`
		SourceTaskID           string                     `json:"source_task_id"`
		BookID                 string                     `json:"book_id"`
		SourceText             string                     `json:"source_text"`
		ApprovedHookScript     string                     `json:"approved_hook_script"`
		CurrentContentToDirect string                     `json:"current_content_to_direct"`
		Style                  string                     `json:"style"`
		Synopsis               string                     `json:"synopsis"`
		ScriptPromptPresetID   string                     `json:"script_prompt_preset_id"`
		AssetPromptPresetID    string                     `json:"asset_prompt_preset_id"`
		VideoModel             DirectorVideoModelSnapshot `json:"video_model"`
		MaxVideoDuration       int                        `json:"max_video_duration"`
		FixedSingleVideo       bool                       `json:"fixed_single_video"`
		ExactDuration          int                        `json:"exact_duration"`
		AspectRatio            string                     `json:"aspect_ratio"`
	}{
		Mode:                   mode,
		SourceTaskID:           strings.TrimSpace(req.SourceTaskID),
		BookID:                 strings.TrimSpace(req.BookID),
		SourceText:             strings.TrimSpace(req.SourceText),
		ApprovedHookScript:     strings.TrimSpace(req.ApprovedHookScript),
		CurrentContentToDirect: currentContent,
		Style:                  strings.TrimSpace(req.Style),
		Synopsis:               strings.TrimSpace(req.Synopsis),
		ScriptPromptPresetID:   scriptID,
		AssetPromptPresetID:    assetID,
		VideoModel:             req.VideoModel,
		MaxVideoDuration:       req.MaxVideoDuration,
		FixedSingleVideo:       req.FixedSingleVideo,
		ExactDuration:          req.ExactDuration,
		AspectRatio:            aspectRatio,
	}
	userPrompt, err := json.MarshalIndent(userPayload, "", "  ")
	if err != nil {
		return PromptContract{}, err
	}

	temperature := 0.35
	if mode == "viral" {
		temperature = 0.65
	}
	return PromptContract{
		SystemPrompt: strings.Join(systemParts, "\n\n---\n\n"),
		UserPrompt:   string(userPrompt),
		Temperature:  temperature,
		MaxTokens:    18000,
		PromptVersions: map[string]PromptVersionMeta{
			directorID:    promptMeta(directorPreset, "system"),
			"scriptPrompt": promptMeta(scriptPreset, scriptSource),
			"assetPrompt":  promptMeta(assetPreset, assetSource),
		},
		Normalization: DirectorSettings{
			MaxVideoDuration:  req.MaxVideoDuration,
			FixedSingleVideo:  req.FixedSingleVideo,
			ExactDuration:     req.ExactDuration,
			AspectRatio:       aspectRatio,
			AllowedPrefixKeys: append([]string(nil), DirectorPrefixKeys...),
		},
	}, nil
}
