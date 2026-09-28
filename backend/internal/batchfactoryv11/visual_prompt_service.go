package batchfactoryv11

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// BuildVisualPromptContract produces a still-image prompt for an already
// existing V11 storyboard. It intentionally receives the existing VIDEO prompt
// as context and never changes the storyboard/video structure.
func BuildVisualPromptContract(book Book, video Video, snapshot DirectorSnapshot) (PromptContract, error) {
	config := aiReasoningPromptConfig(snapshot.Effective)
	if !config.Visual.appliesTo(book) {
		return PromptContract{}, fmt.Errorf("%w: 请先在 AI 推理中启用画面提示词", ErrConflict)
	}
	videoPrompt := strings.TrimSpace(video.VideoPrompt)
	if videoPrompt == "" {
		return PromptContract{}, fmt.Errorf("%w: 当前分镜没有视频提示词", ErrConflict)
	}
	assets := make([]map[string]string, 0, len(book.AssetRecords))
	for _, asset := range book.AssetRecords {
		if name, prompt := strings.TrimSpace(asset.Name), strings.TrimSpace(asset.Prompt); name != "" && prompt != "" {
			assets = append(assets, map[string]string{"kind": asset.Kind, "name": name, "prompt": prompt})
		}
	}
	if len(assets) == 0 {
		for _, asset := range append(append([]NamedPrompt{}, book.Assets.Characters...), append(book.Assets.Scenes, book.Assets.Props...)...) {
			if name, prompt := strings.TrimSpace(asset.Name), strings.TrimSpace(asset.Prompt); name != "" && prompt != "" {
				assets = append(assets, map[string]string{"name": name, "prompt": prompt})
			}
		}
	}
	payload, err := json.Marshal(map[string]any{
		"book_title":   book.Title,
		"source_text":  book.SourceText,
		"video_label":  video.Label,
		"duration_sec": video.DurationSeconds,
		"video_prompt": videoPrompt,
		"book_assets":  assets,
		"aspect_ratio": EffectiveImageAspectRatio(snapshot.Effective),
	})
	if err != nil {
		return PromptContract{}, err
	}
	system := "你是 Batch Factory V11 的画面提示词生成器。只输出当前分镜用于生成首帧或画面图片的一段中文画面提示词，不要输出 Markdown、JSON、标题、解释或视频运镜指令。画面提示词只服务图片生成，绝不改变 video_prompt。\n\n当前画面提示词预设：\n" + config.Visual.body()
	return PromptContract{SystemPrompt: system, UserPrompt: string(payload), Temperature: 0.25, MaxTokens: 2400}, nil
}

// RunVisualPromptExtraction regenerates only visual prompts for this book's
// existing storyboards. VIDEO prompts and director revisions are left intact.
func (s *DirectorService) RunVisualPromptExtraction(ctx context.Context, owner, batchID, bookID string) ([]Video, error) {
	if err := s.validate(); err != nil {
		return nil, err
	}
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil {
		return nil, err
	}
	book, err := bookFromBatch(batch, bookID)
	if err != nil {
		return nil, err
	}
	book, err = s.productionBook(ctx, owner, batchID, book)
	if err != nil {
		return nil, err
	}
	if len(book.Videos) == 0 {
		return nil, fmt.Errorf("%w: 请先提取视频分镜", ErrConflict)
	}
	snapshot, err := snapshotForBook(batch, book)
	if err != nil {
		return nil, err
	}
	if !aiReasoningPromptConfig(snapshot.Effective).Visual.appliesTo(book) {
		return nil, fmt.Errorf("%w: 请先在 AI 推理中启用画面提示词", ErrConflict)
	}
	updated := make([]Video, 0, len(book.Videos))
	for _, video := range book.Videos {
		contract, err := BuildVisualPromptContract(book, video, snapshot)
		if err != nil {
			return nil, err
		}
		prompt, err := s.Provider.Complete(ctx, TextCompletionRequest{SystemPrompt: contract.SystemPrompt, UserPrompt: contract.UserPrompt, Temperature: contract.Temperature, MaxTokens: contract.MaxTokens})
		if err != nil {
			return nil, err
		}
		prompt = strings.TrimSpace(prompt)
		if prompt == "" {
			return nil, fmt.Errorf("%w: 画面提示词为空", ErrInvalid)
		}
		encoded, _ := json.Marshal(prompt)
		result, err := s.Store.SaveSettings(ctx, owner, ScopeRef{Kind: ScopeVideo, BatchID: batchID, BookID: bookID, VideoID: video.ID}, SettingsUpdate{
			Patch:            SettingsPatch{"visualPrompt": encoded},
			ExpectedRevision: video.Revision,
		})
		if err != nil {
			return nil, err
		}
		video.VisualPrompt = prompt
		video.Revision = result.Revision
		video.SettingsState = SettingsState{Patch: result.Patch, Revision: result.Revision}
		updated = append(updated, video)
	}
	return updated, nil
}
