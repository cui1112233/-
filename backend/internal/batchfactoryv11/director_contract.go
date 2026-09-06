package batchfactoryv11

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

type TextCompletionRequest struct {
	SystemPrompt string
	UserPrompt   string
	Temperature  float64
	MaxTokens    int
}

type PromptContract struct {
	SystemPrompt  string
	UserPrompt    string
	Temperature   float64
	MaxTokens     int
	Normalization DirectorSettings
}

func BuildHookContract(book Book, prompt Prompt) PromptContract {
	system := strings.TrimSpace(prompt.Content)
	return PromptContract{
		SystemPrompt: system,
		UserPrompt:   "小说标题：" + book.Title + "\n\n原文：\n" + sourceForPrompt(book),
		Temperature:  0.75,
		MaxTokens:    5000,
	}
}

func BuildDirectorContract(book Book, hook HookRevision, snapshot DirectorSnapshot, bundle PromptBundle) (PromptContract, error) {
	mode := snapshot.Mode
	if mode != "original" && mode != "viral" {
		return PromptContract{}, fmt.Errorf("%w: unsupported director mode", ErrInvalid)
	}
	if mode == "viral" && (hook.ID == "" || hook.Status != "approved") {
		return PromptContract{}, fmt.Errorf("%w: viral mode requires approved Hook", ErrConflict)
	}
	durationRule := fmt.Sprintf("每个 VIDEO 的 duration_sec 必须为 1-%d 的整数。", snapshot.MaxVideoDuration)
	if snapshot.FixedSingleVideo {
		durationRule = fmt.Sprintf("只输出一个 VIDEO，duration_sec 必须严格等于 %d；后续未覆盖原文不得展示，并在 source_coverage 标记仍有剩余。", snapshot.ExactDuration)
	}
	system := strings.Join([]string{
		strings.TrimSpace(bundle.Script.Content),
		strings.TrimSpace(bundle.Asset.Content),
		strings.TrimSpace(bundle.Video.Content),
		`你是 Batch Factory V11 的导演。只输出合法 JSON，不要输出 Markdown。
JSON 顶层必须包含 characters、scenes、props、storyboard、source_coverage。
characters/scenes/props 的每项必须包含 name 与 prompt。
storyboard 每项必须包含 duration_sec、characters、props、scene、prefix_key、shots、video_desc。
shots 必须从 0 秒开始连续、无空白无重叠，最后一个 end_sec 必须等于 duration_sec。
人物、场景、道具引用必须来自顶层信息库。prefix_key 只能从指定列表选择。
原文模式按原文顺序完整覆盖；爆款模式以已批准 Hook 开场，并继续覆盖原文。
不得把普通情绪只换成形容词；冲突升级要通过动作、表情、对白和可见行为呈现。
		`,
	}, "\n\n---\n\n") + "\n" + durationRule + "\n画幅：" + snapshot.AspectRatio + "\n允许的 prefix_key：" + strings.Join(DirectorPrefixKeys, ", ")
	payload := map[string]any{
		"book_id":     book.ID,
		"title":       book.Title,
		"mode":        mode,
		"source_text": sourceForPrompt(book),
	}
	if mode == "viral" {
		payload["approved_hook"] = hook.Text
	}
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return PromptContract{}, err
	}
	temperature := 0.35
	if mode == "viral" {
		temperature = 0.65
	}
	return PromptContract{
		SystemPrompt: system,
		UserPrompt:   string(encoded),
		Temperature:  temperature,
		MaxTokens:    18000,
		Normalization: DirectorSettings{
			MaxVideoDuration:  snapshot.MaxVideoDuration,
			FixedSingleVideo:  snapshot.FixedSingleVideo,
			ExactDuration:     snapshot.ExactDuration,
			AspectRatio:       snapshot.AspectRatio,
			AllowedPrefixKeys: append([]string(nil), DirectorPrefixKeys...),
		},
	}, nil
}

func sourceForPrompt(book Book) string {
	if strings.TrimSpace(book.ContentPreview) != "" {
		return book.ContentPreview
	}
	return book.SourceText
}
