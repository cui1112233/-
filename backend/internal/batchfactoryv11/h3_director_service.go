package batchfactoryv11

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type H3DirectorPreset struct {
	Key        string `json:"key"`
	Revision   int64  `json:"revision"`
	PromptBody string `json:"prompt_body,omitempty"`
}

type H3DirectorRunRequest struct {
	VideoSource H3VideoSource    `json:"video_source"`
	Preset      H3DirectorPreset `json:"preset"`
}

func (s *DirectorService) RunH3Director(ctx context.Context, owner, batchID, bookID string, request H3DirectorRunRequest) (DirectorRevision, error) {
	if err := s.validate(); err != nil {
		return DirectorRevision{}, err
	}
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil {
		return DirectorRevision{}, err
	}
	book, err := bookFromBatch(batch, bookID)
	if err != nil {
		return DirectorRevision{}, err
	}
	source, err := normalizeH3VideoSource(request.VideoSource)
	if err != nil {
		return DirectorRevision{}, err
	}
	if strings.TrimSpace(request.Preset.Key) == "" || request.Preset.Revision <= 0 {
		return DirectorRevision{}, fmt.Errorf("%w: H3 director preset key and revision are required", ErrInvalid)
	}
	snapshot, err := h3SnapshotForBook(batch, book)
	if err != nil {
		return DirectorRevision{}, err
	}
	contract := buildH3DirectorContract(source, request.Preset)
	completion, err := s.Provider.Complete(ctx, contract)
	if err != nil {
		return DirectorRevision{}, err
	}
	raw, err := ParseDirectorJSON(completion)
	if err != nil {
		return DirectorRevision{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	document, err := ParseH3DirectorDocument(raw, source)
	if err != nil {
		return DirectorRevision{}, err
	}
	if document.DirectorPresetKey != request.Preset.Key || document.DirectorPresetRevision != request.Preset.Revision {
		return DirectorRevision{}, fmt.Errorf("%w: H3 director output preset does not match frozen preset", ErrInvalid)
	}
	if strings.TrimSpace(document.VisualBaseline) == "" {
		return DirectorRevision{}, fmt.Errorf("%w: H3 visual_baseline is required", ErrInvalid)
	}
	return s.Store.PersistDirectorRevision(ctx, owner, book, snapshot, source.Hash, "", DirectorResult{H3Director: &document})
}

func normalizeH3VideoSource(source H3VideoSource) (H3VideoSource, error) {
	source.Revision = strings.TrimSpace(source.Revision)
	if source.Revision == "" {
		return H3VideoSource{}, fmt.Errorf("%w: H3 video source revision is required", ErrInvalid)
	}
	lines := h3NonEmptyVideoSourceLines(source.Text)
	if len(lines) == 0 {
		return H3VideoSource{}, fmt.Errorf("%w: processed video source has no non-empty lines", ErrInvalid)
	}
	normalizedText := strings.Join(lines, "\n")
	computedHash := sourceDigest(normalizedText)
	if supplied := strings.TrimSpace(source.Hash); supplied != "" && supplied != computedHash {
		return H3VideoSource{}, fmt.Errorf("%w: H3 video source hash does not match processed non-empty lines", ErrInvalid)
	}
	return H3VideoSource{Revision: source.Revision, Hash: computedHash, Text: normalizedText}, nil
}

func h3SnapshotForBook(batch Batch, book Book) (DirectorSnapshot, error) {
	effective := ResolveSettings(batch.SettingsState.Patch, book.SettingsState.Patch)
	maxDuration := rawInt(effective, "storyboardDurationLimit", 10)
	if maxDuration != 10 && maxDuration != 15 {
		return DirectorSnapshot{}, fmt.Errorf("%w: storyboardDurationLimit must be 10 or 15", ErrInvalid)
	}
	aspect := rawString(effective, "aspectRatio", "9:16")
	if aspect != "9:16" && aspect != "16:9" {
		return DirectorSnapshot{}, fmt.Errorf("%w: unsupported aspect ratio", ErrInvalid)
	}
	return DirectorSnapshot{Effective: effective, Mode: "h3", MaxVideoDuration: maxDuration, AspectRatio: aspect}, nil
}

func buildH3DirectorContract(source H3VideoSource, preset H3DirectorPreset) TextCompletionRequest {
	schema := `你是 H3 结构化导演内核。只输出一个 JSON 对象，不要 Markdown。
必须输出 schema_version="h3-director/v1"、writer="batch-factory-v12"、video_source_revision、video_source_hash、video_source_non_empty_line_count、director_preset_key、director_preset_revision、visual_baseline、character_roster[]、director_cards[]。
每个非空视频原文行必须且只能对应一张 director_card，顺序一致；卡内保存 source_index/source_key/source_text/source_text_hash/visual_context/preferred_duration/duration_weight/character_slot_ids/action/camera/movement/rhythm/audio/continuity/micro_shots。
character_slot_ids 必须显式输出数组，无人镜头使用 []；非空引用必须指向 character_roster.slot_id。continuity 必须是结构化对象，包含 scene_id/location/axis/light_direction/positions/facings/gazes/held_props/action_ends，禁止用 scene_memory 字符串替代。
每张卡至少一个 micro_shot，微镜头必须包含 micro_shot_key/weight/shot_task/visual/action/character_slot_ids/camera/movement/rhythm/audio。
AI 只给出 preferred_duration 和正数 duration_weight 表达语义节奏；不得输出最终秒数、最终分段或随机 VIDEO 时长。视觉基线、人物分析和场景连续性必须始终生成并保存。`
	if body := strings.TrimSpace(preset.PromptBody); body != "" {
		schema += "\n\n导演预设补充约束：\n" + body
	}
	meta, _ := json.Marshal(map[string]any{
		"video_source_revision":    source.Revision,
		"video_source_hash":        source.Hash,
		"director_preset_key":      preset.Key,
		"director_preset_revision": preset.Revision,
	})
	return TextCompletionRequest{
		SystemPrompt: schema,
		UserPrompt:   string(meta) + "\n\n以下是 H3 已处理的视频原文，一行一张导演卡：\n" + source.Text,
		Temperature:  0.1,
		MaxTokens:    32000,
	}
}
