package segmentation

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/prompts"
)

var ErrSegmentsUnconfirmed = errors.New("segments must be confirmed before production")

const (
	StatusDraft     = "draft"
	StatusCandidate = "candidate"
	StatusConfirmed = "confirmed"
)

type CandidateSegment struct {
	Text    string `json:"text"`
	Speaker string `json:"speaker"`
}

type SmartGenerator interface {
	GenerateSegments(ctx context.Context, modelID int64, renderedPrompt string) ([]CandidateSegment, error)
}

type SmartService struct {
	prompts   *prompts.Service
	generator SmartGenerator
}

func NewSmartService(promptService *prompts.Service, generator SmartGenerator) *SmartService {
	return &SmartService{prompts: promptService, generator: generator}
}

func (s *SmartService) Candidates(ctx context.Context, project domain.Project, selection prompts.Selection, modelID int64) ([]CandidateSegment, prompts.PromptSnapshot, error) {
	if modelID < 1 || s.prompts == nil || s.generator == nil {
		return nil, prompts.PromptSnapshot{}, fmt.Errorf("smart segmentation model and prompt service are required")
	}
	snapshot, err := s.prompts.Assemble(ctx, selection, prompts.AssembleInput{NovelText: project.SourceText})
	if err != nil {
		return nil, prompts.PromptSnapshot{}, err
	}
	candidates, err := s.generator.GenerateSegments(ctx, modelID, snapshot.Rendered)
	if err != nil {
		return nil, prompts.PromptSnapshot{}, err
	}
	return candidates, snapshot, nil
}

func FixedLineSegments(text string, linesPerSegment int) []CandidateSegment {
	if linesPerSegment < 1 {
		return nil
	}
	lines := nonEmptyLines(text)
	result := make([]CandidateSegment, 0, (len(lines)+linesPerSegment-1)/linesPerSegment)
	for start := 0; start < len(lines); start += linesPerSegment {
		end := start + linesPerSegment
		if end > len(lines) {
			end = len(lines)
		}
		result = append(result, CandidateSegment{Text: strings.Join(lines[start:end], "\n")})
	}
	return result
}

func ParagraphSegments(text string) []CandidateSegment {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	result := make([]CandidateSegment, 0)
	paragraph := make([]string, 0)
	flush := func() {
		if len(paragraph) == 0 {
			return
		}
		result = append(result, CandidateSegment{Text: strings.Join(paragraph, "\n")})
		paragraph = paragraph[:0]
	}
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			flush()
			continue
		}
		paragraph = append(paragraph, line)
	}
	flush()
	return result
}

func EnsureSegmentsConfirmed(project domain.Project) error {
	if project.SegmentationStatus != StatusConfirmed {
		return ErrSegmentsUnconfirmed
	}
	return nil
}

func MarkDraft(project *domain.Project) { project.SegmentationStatus = StatusDraft }

func nonEmptyLines(text string) []string {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		if line = strings.TrimSpace(line); line != "" {
			result = append(result, line)
		}
	}
	return result
}

func isNumberLine(line string) bool {
	line = strings.TrimSpace(line)
	if line == "" {
		return false
	}
	if strings.HasPrefix(line, "第") && strings.HasSuffix(line, "段") {
		line = strings.TrimSuffix(strings.TrimPrefix(line, "第"), "段")
	}
	line = strings.TrimRight(line, ".、")
	return line != "" && strings.IndexFunc(line, func(r rune) bool { return !unicode.IsDigit(r) }) == -1
}
