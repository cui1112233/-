package prompts

import (
	"context"
	"fmt"
	"strings"
)

type Preset struct {
	ID         int64
	VersionID  int64
	Module     string
	Purpose    string
	Name       string
	Parameters []string
	Body       string
	Enabled    bool
}

type PublicPreset struct {
	ID         int64    `json:"id"`
	VersionID  int64    `json:"versionId"`
	Module     string   `json:"module"`
	Purpose    string   `json:"purpose"`
	Name       string   `json:"name"`
	Parameters []string `json:"parameters"`
}

func ToPublicPreset(preset Preset) PublicPreset {
	return PublicPreset{
		ID: preset.ID, VersionID: preset.VersionID, Module: preset.Module,
		Purpose: preset.Purpose, Name: preset.Name, Parameters: append([]string(nil), preset.Parameters...),
	}
}

type Selection struct {
	BaseID   int64
	AddonIDs []int64
}

type AssembleInput struct {
	NovelText   string
	SegmentText string
	ProjectNote string
}

type PromptSnapshot struct {
	BaseVersionID   int64
	AddonVersionIDs []int64
	Rendered        string
}

type Repository interface {
	ResolveEnabled(ctx context.Context, module string, selection Selection) (Preset, []Preset, error)
}

type Service struct {
	repo   Repository
	module string
}

func NewService(repo Repository, module string) *Service {
	return &Service{repo: repo, module: module}
}

func (s *Service) Assemble(ctx context.Context, selection Selection, input AssembleInput) (PromptSnapshot, error) {
	if s.repo == nil {
		return PromptSnapshot{}, fmt.Errorf("prompt repository is required")
	}
	base, addons, err := s.repo.ResolveEnabled(ctx, s.module, selection)
	if err != nil {
		return PromptSnapshot{}, err
	}
	if !base.Enabled || base.Body == "" {
		return PromptSnapshot{}, fmt.Errorf("base prompt is not enabled")
	}
	bodies := []string{base.Body}
	versions := make([]int64, 0, len(addons))
	for _, addon := range addons {
		if !addon.Enabled {
			return PromptSnapshot{}, fmt.Errorf("addon prompt %d is not enabled", addon.ID)
		}
		bodies = append(bodies, addon.Body)
		versions = append(versions, addon.VersionID)
	}
	rendered := strings.NewReplacer(
		"{{novel_text}}", input.NovelText,
		"{{segment_text}}", input.SegmentText,
		"{{project_note}}", input.ProjectNote,
	).Replace(strings.Join(bodies, "\n\n"))
	return PromptSnapshot{BaseVersionID: base.VersionID, AddonVersionIDs: versions, Rendered: rendered}, nil
}
