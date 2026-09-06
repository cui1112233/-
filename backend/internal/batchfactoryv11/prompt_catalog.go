package batchfactoryv11

import (
	"context"
	"fmt"
	"strings"
)

type PromptBundle struct {
	Hook   Prompt
	Script Prompt
	Asset  Prompt
	Video  Prompt
}

type PromptCatalog struct {
	Store Store
}

func NewPromptCatalog(store Store) *PromptCatalog {
	return &PromptCatalog{Store: store}
}

func SystemPromptCatalog() []Prompt {
	return []Prompt{
		{ID: "system-hook-v1", VersionID: "system-hook-v1", Name: "爆款开头基础规则", Kind: "hook", Content: `你是短剧爆款开头改写导演。生成一段可人工审核的 Hook。
必须在不改变人物身份、因果关系和安全边界的前提下，把原文中的核心冲突提前并放大。
情绪升级必须表现为可见冲突和行为升级（visible conflict / behavior escalation），不能只增加“非常生气”等形容词。
保留能衔接后续原文的信息。只输出 Hook 正文，不要解释。`},
		{ID: "system-script-v1", VersionID: "system-script-v1", Name: "标准短剧编剧规则", Kind: "script", Content: `你是短剧编剧。根据内容窗口生成可执行的短剧分镜，保留人物关系、因果关系和原文冲突，不补造窗口外事实。`},
		{ID: "system-asset-v1", VersionID: "system-asset-v1", Name: "人物场景道具规则", Kind: "asset", Content: `人物、场景、道具必须分别输出稳定、可复用、可直接用于生成的提示词；同一名称在全书内保持外观和空间关系一致。`},
		{ID: "system-video-v1", VersionID: "system-video-v1", Name: "视频提示词规则", Kind: "video", Content: `每个视频片段必须给出可拍的动作、镜头、人物、场景和道具引用；视频提示词不得遗漏内容窗口中的关键动作和对白。`},
	}
}

func (c *PromptCatalog) List(ctx context.Context, owner, kind string) ([]Prompt, error) {
	result := make([]Prompt, 0)
	for _, prompt := range SystemPromptCatalog() {
		if strings.TrimSpace(kind) == "" || prompt.Kind == kind {
			result = append(result, prompt)
		}
	}
	if c == nil || c.Store == nil {
		return result, nil
	}
	custom, err := c.Store.ListPrompts(ctx, owner, kind)
	if err != nil {
		return nil, err
	}
	return append(result, custom...), nil
}

func (c *PromptCatalog) Resolve(ctx context.Context, owner, kind, selectedID string) (Prompt, error) {
	records, err := c.List(ctx, owner, kind)
	if err != nil {
		return Prompt{}, err
	}
	selectedID = strings.TrimSpace(selectedID)
	if selectedID == "" {
		for _, record := range records {
			if strings.HasPrefix(record.ID, "system-") {
				return record, nil
			}
		}
	}
	for _, record := range records {
		if record.ID == selectedID {
			return record, nil
		}
	}
	return Prompt{}, fmt.Errorf("%w: prompt %s (%s) not found", ErrNotFound, selectedID, kind)
}

func (c *PromptCatalog) ResolvePromptBundle(ctx context.Context, owner string, effective SettingsPatch) (PromptBundle, error) {
	if c == nil {
		c = NewPromptCatalog(nil)
	}
	hook, err := c.Resolve(ctx, owner, "hook", rawString(effective, "hookPromptPresetId", ""))
	if err != nil {
		return PromptBundle{}, err
	}
	script, err := c.Resolve(ctx, owner, "script", rawString(effective, "scriptPromptPresetId", ""))
	if err != nil {
		return PromptBundle{}, err
	}
	asset, err := c.Resolve(ctx, owner, "asset", rawString(effective, "assetPromptPresetId", ""))
	if err != nil {
		return PromptBundle{}, err
	}
	video, err := c.Resolve(ctx, owner, "video", rawString(effective, "videoPromptPresetId", ""))
	if err != nil {
		return PromptBundle{}, err
	}
	return PromptBundle{Hook: hook, Script: script, Asset: asset, Video: video}, nil
}
