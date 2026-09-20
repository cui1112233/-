package batchfactoryv11

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
)

type DirectorService struct {
	Store    Store
	Provider DirectorProvider
}

func sourceDigest(source string) string {
	sum := sha256.Sum256([]byte(source))
	return hex.EncodeToString(sum[:])
}

func rawString(patch SettingsPatch, key, fallback string) string {
	raw, ok := patch[key]
	if !ok {
		return fallback
	}
	var value string
	if json.Unmarshal(raw, &value) != nil || strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func rawBool(patch SettingsPatch, key string, fallback bool) bool {
	raw, ok := patch[key]
	if !ok {
		return fallback
	}
	var value bool
	if json.Unmarshal(raw, &value) != nil {
		return fallback
	}
	return value
}

func rawInt(patch SettingsPatch, key string, fallback int) int {
	raw, ok := patch[key]
	if !ok {
		return fallback
	}
	var value int
	if json.Unmarshal(raw, &value) != nil {
		return fallback
	}
	return value
}

// storyboard durations are integer seconds. Keep the measured audio value in
// settings, but plan against the same ceiling rule used by script generation.
func measuredAudioDurationSeconds(patch SettingsPatch) float64 {
	if !rawBool(patch, "audioPlanningEnabled", false) {
		return 0
	}
	raw, ok := patch["audioDurationSeconds"]
	if !ok {
		return 0
	}
	var seconds float64
	if json.Unmarshal(raw, &seconds) != nil || math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds <= 0 {
		return 0
	}
	return seconds
}

func audioTargetSeconds(patch SettingsPatch) int {
	seconds := measuredAudioDurationSeconds(patch)
	if seconds <= 0 {
		return 0
	}
	return int(math.Ceil(seconds))
}

func audioMinimumVideoCount(targetSeconds, maxVideoDuration int) int {
	if targetSeconds <= 0 || maxVideoDuration <= 0 {
		return 0
	}
	return int(math.Ceil(float64(targetSeconds) / float64(maxVideoDuration)))
}

func bookFromBatch(batch Batch, bookID string) (Book, error) {
	for _, book := range batch.Books {
		if book.ID == bookID {
			return book, nil
		}
	}
	return Book{}, ErrNotFound
}

func snapshotForBook(batch Batch, book Book) (DirectorSnapshot, error) {
	effective := ResolveSettings(batch.SettingsState.Patch, book.SettingsState.Patch)
	mode := rawString(effective, "productionMode", rawString(effective, "mode", "original"))
	if mode == "original_direct" {
		mode = "original"
	}
	if mode == "viral_hook" {
		mode = "viral"
	}
	maxDuration := rawInt(effective, "storyboardDurationLimit", 10)
	if maxDuration != 10 && maxDuration != 15 {
		return DirectorSnapshot{}, fmt.Errorf("%w: storyboardDurationLimit must be 10 or 15", ErrInvalid)
	}
	fixed := rawBool(effective, "fixedSingleVideo", false)
	audioPlanning := rawBool(effective, "audioPlanningEnabled", false)
	if fixed && audioPlanning {
		return DirectorSnapshot{}, fmt.Errorf("%w: 固定开头只生产 VIDEO01，不能同时启用分镜规划跟随配音", ErrConflict)
	}
	if audioPlanning && audioTargetSeconds(effective) == 0 {
		return DirectorSnapshot{}, fmt.Errorf("%w: 音频规划已开启，请先生成配音并读取真实时长", ErrConflict)
	}
	aspect := rawString(effective, "aspectRatio", "9:16")
	if aspect != "9:16" && aspect != "16:9" {
		return DirectorSnapshot{}, fmt.Errorf("%w: unsupported aspect ratio", ErrInvalid)
	}
	if mode != "original" && mode != "viral" {
		return DirectorSnapshot{}, fmt.Errorf("%w: unsupported director mode", ErrInvalid)
	}
	return DirectorSnapshot{Effective: effective, Mode: mode, MaxVideoDuration: maxDuration, AudioDurationSeconds: measuredAudioDurationSeconds(effective), AudioTargetSeconds: audioTargetSeconds(effective), FixedSingleVideo: fixed, AspectRatio: aspect}, nil
}

func (s *DirectorService) validate() error {
	if s == nil || s.Store == nil || s.Provider == nil {
		return ErrUnavailable
	}
	return nil
}

// productionBook returns a copy that keeps sourceText immutable while allowing
// a user-approved per-book working front to drive Hook and Director generation.
// The draft is deliberately separate from captured source text: publishing can
// later choose either source or the approved rewrite without destructive edits.
func (s *DirectorService) productionBook(ctx context.Context, owner, batchID string, book Book) (Book, error) {
	draft, err := s.Store.GetDraft(ctx, owner, "working-front:"+book.ID, "working-front-content", batchID)
	if err == nil && strings.TrimSpace(draft.Content) != "" {
		book.SourceText = strings.TrimSpace(draft.Content)
		return book, nil
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		return Book{}, err
	}
	book.SourceText = productionTextForBook(book)
	return book, nil
}

func productionTextForBook(book Book) string {
	limit := 5
	if raw, ok := book.SourceMetadata["contentRangeLines"]; ok {
		switch value := raw.(type) {
		case float64:
			limit = int(value)
		case int:
			limit = value
		case int64:
			limit = int(value)
		case json.Number:
			if parsed, err := value.Int64(); err == nil {
				limit = int(parsed)
			}
		}
	}
	if limit < 1 {
		limit = 5
	} else if limit > 500 {
		limit = 500
	}
	lines := h3NonEmptyVideoSourceLines(book.SourceText)
	if len(lines) > limit {
		lines = lines[:limit]
	}
	return strings.Join(lines, "\n")
}

// RewriteWorkingFront generates a candidate only. The approved working front
// remains unchanged until the user explicitly saves it from the workbench.
func (s *DirectorService) RewriteWorkingFront(ctx context.Context, owner, batchID, bookID, currentText string, opening PresetSnapshot) (string, error) {
	if err := s.validate(); err != nil {
		return "", err
	}
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil {
		return "", err
	}
	book, err := bookFromBatch(batch, bookID)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(currentText) != "" {
		book.SourceText = strings.TrimSpace(currentText)
	} else {
		book, err = s.productionBook(ctx, owner, batchID, book)
		if err != nil {
			return "", err
		}
	}
	if strings.TrimSpace(book.SourceText) == "" {
		return "", fmt.Errorf("%w: working front text is required", ErrInvalid)
	}
	contract := BuildWorkingFrontRewriteContract(book, opening)
	candidate, err := s.Provider.Complete(ctx, TextCompletionRequest{SystemPrompt: contract.SystemPrompt, UserPrompt: contract.UserPrompt, Temperature: contract.Temperature, MaxTokens: contract.MaxTokens})
	if err != nil {
		return "", err
	}
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return "", fmt.Errorf("%w: empty working-front rewrite", ErrInvalid)
	}
	if _, err := s.Store.SaveDraft(ctx, owner, Draft{Key: "working-front-candidate:" + book.ID, Kind: "working-front-viral-candidate", Scope: batchID, Content: candidate}); err != nil {
		return "", err
	}
	return candidate, nil
}

func (s *DirectorService) RunHook(ctx context.Context, owner, batchID, bookID string) (HookRevision, error) {
	if err := s.validate(); err != nil {
		return HookRevision{}, err
	}
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil {
		return HookRevision{}, err
	}
	book, err := bookFromBatch(batch, bookID)
	if err != nil {
		return HookRevision{}, err
	}
	book, err = s.productionBook(ctx, owner, batchID, book)
	if err != nil {
		return HookRevision{}, err
	}
	snapshot, err := snapshotForBook(batch, book)
	if err != nil {
		return HookRevision{}, err
	}
	if snapshot.Mode != "viral" {
		return HookRevision{}, fmt.Errorf("%w: Hook is only available in viral mode", ErrConflict)
	}
	if strings.TrimSpace(book.SourceText) == "" {
		return HookRevision{}, fmt.Errorf("%w: source text is required", ErrInvalid)
	}
	contract := BuildHookContract(book, snapshot)
	text, err := s.Provider.Complete(ctx, TextCompletionRequest{SystemPrompt: contract.SystemPrompt, UserPrompt: contract.UserPrompt, Temperature: contract.Temperature, MaxTokens: contract.MaxTokens})
	if err != nil {
		return HookRevision{}, err
	}
	return s.Store.CreateHookRevision(ctx, owner, batchID, bookID, strings.TrimSpace(text), sourceDigest(book.SourceText))
}

func (s *DirectorService) ApproveHook(ctx context.Context, owner, batchID, bookID, hookID string) (HookRevision, error) {
	if err := s.validate(); err != nil {
		return HookRevision{}, err
	}
	return s.Store.ApproveHookRevision(ctx, owner, batchID, bookID, hookID)
}

func (s *DirectorService) RunDirector(ctx context.Context, owner, batchID, bookID string) (DirectorRevision, error) {
	return s.runDirector(ctx, owner, batchID, bookID, "")
}

// RunDirectorWithSmartUnifiedStyle accepts only a bridge-derived, validated
// full-book visual analysis. The user controls the selected preset; the model
// result is kept with this director revision rather than mutable settings.
func (s *DirectorService) RunDirectorWithSmartUnifiedStyle(ctx context.Context, owner, batchID, bookID, style string) (DirectorRevision, error) {
	return s.runDirector(ctx, owner, batchID, bookID, strings.TrimSpace(style))
}

func (s *DirectorService) runDirector(ctx context.Context, owner, batchID, bookID, smartUnifiedStyle string) (DirectorRevision, error) {
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
	book, err = s.productionBook(ctx, owner, batchID, book)
	if err != nil {
		return DirectorRevision{}, err
	}
	if strings.TrimSpace(book.SourceText) == "" {
		return DirectorRevision{}, fmt.Errorf("%w: source text is required", ErrInvalid)
	}
	snapshot, err := snapshotForBook(batch, book)
	if err != nil {
		return DirectorRevision{}, err
	}
	if smartUnifiedStyle != "" {
		encoded, _ := json.Marshal(smartUnifiedStyle)
		snapshot.Effective["smartUnifiedStyle"] = encoded
	}
	hook := HookRevision{}
	if snapshot.Mode == "viral" {
		hook, err = s.Store.LatestHookRevision(ctx, owner, batchID, bookID)
		if err != nil {
			return DirectorRevision{}, fmt.Errorf("%w: viral mode requires approved Hook", ErrConflict)
		}
		if hook.Status != "approved" {
			return DirectorRevision{}, fmt.Errorf("%w: viral mode requires approved Hook", ErrConflict)
		}
	}
	contract, err := BuildDirectorContract(book, hook, snapshot)
	if err != nil {
		return DirectorRevision{}, err
	}
	completion, err := s.Provider.Complete(ctx, TextCompletionRequest{SystemPrompt: contract.SystemPrompt, UserPrompt: contract.UserPrompt, Temperature: contract.Temperature, MaxTokens: contract.MaxTokens})
	if err != nil {
		return DirectorRevision{}, err
	}
	raw, err := ParseDirectorJSON(completion)
	if err != nil {
		return DirectorRevision{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	result, err := NormalizeDirectorOutput(raw, contract.Normalization)
	if err != nil {
		return DirectorRevision{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	result.SmartUnifiedStyle = smartUnifiedStyle
	return s.Store.PersistDirectorRevision(ctx, owner, book, snapshot, sourceDigest(book.SourceText), hook.ID, result)
}

// RunAssetExtraction runs the compact asset-only request. Existing director
// revisions, storyboard prompts and VIDEO records are intentionally untouched.
func (s *DirectorService) RunAssetExtraction(ctx context.Context, owner, batchID, bookID string) ([]BookAsset, error) {
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
	snapshot, err := snapshotForBook(batch, book)
	if err != nil {
		return nil, err
	}
	contract, err := BuildAssetExtractionContract(book, snapshot)
	if err != nil {
		return nil, err
	}
	completion, err := s.Provider.Complete(ctx, TextCompletionRequest{SystemPrompt: contract.SystemPrompt, UserPrompt: contract.UserPrompt, Temperature: contract.Temperature, MaxTokens: contract.MaxTokens})
	if err != nil {
		return nil, err
	}
	raw, err := ParseDirectorJSON(completion)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	assets, err := NormalizeAssetExtractionOutput(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	assets, err = s.compileH3AssetPrompts(ctx, book, snapshot, assets)
	if err != nil {
		return nil, err
	}
	return s.Store.PersistExtractedBookAssets(ctx, owner, book, snapshot, assets)
}
