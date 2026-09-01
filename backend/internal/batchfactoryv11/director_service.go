package batchfactoryv11

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	if !ok { return fallback }
	var value bool
	if json.Unmarshal(raw, &value) != nil { return fallback }
	return value
}

func rawInt(patch SettingsPatch, key string, fallback int) int {
	raw, ok := patch[key]
	if !ok { return fallback }
	var value int
	if json.Unmarshal(raw, &value) != nil { return fallback }
	return value
}

func bookFromBatch(batch Batch, bookID string) (Book, error) {
	for _, book := range batch.Books {
		if book.ID == bookID { return book, nil }
	}
	return Book{}, ErrNotFound
}

func snapshotForBook(batch Batch, book Book) (DirectorSnapshot, error) {
	effective := ResolveSettings(batch.SettingsState.Patch, book.SettingsState.Patch)
	mode := rawString(effective, "productionMode", rawString(effective, "mode", "original"))
	if mode == "original_direct" { mode = "original" }
	if mode == "viral_hook" { mode = "viral" }
	maxDuration := rawInt(effective, "maxVideoDuration", rawInt(effective, "modelMaxDuration", 15))
	if maxDuration < 1 || maxDuration > 60 {
		return DirectorSnapshot{}, fmt.Errorf("%w: maxVideoDuration must be within 1-60", ErrInvalid)
	}
	fixed := rawBool(effective, "fixedSingleVideo", false)
	exact := rawInt(effective, "fixedVideoDuration", rawInt(effective, "exactDuration", maxDuration))
	if fixed && (exact < 1 || exact > maxDuration) {
		return DirectorSnapshot{}, fmt.Errorf("%w: fixed duration exceeds model maximum", ErrInvalid)
	}
	aspect := rawString(effective, "aspectRatio", "9:16")
	if aspect != "9:16" && aspect != "16:9" {
		return DirectorSnapshot{}, fmt.Errorf("%w: unsupported aspect ratio", ErrInvalid)
	}
	if mode != "original" && mode != "viral" {
		return DirectorSnapshot{}, fmt.Errorf("%w: unsupported director mode", ErrInvalid)
	}
	return DirectorSnapshot{Effective: effective, Mode: mode, MaxVideoDuration: maxDuration, FixedSingleVideo: fixed, ExactDuration: exact, AspectRatio: aspect}, nil
}

func (s *DirectorService) validate() error {
	if s == nil || s.Store == nil || s.Provider == nil { return ErrUnavailable }
	return nil
}

func (s *DirectorService) RunHook(ctx context.Context, owner, batchID, bookID string) (HookRevision, error) {
	if err := s.validate(); err != nil { return HookRevision{}, err }
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil { return HookRevision{}, err }
	book, err := bookFromBatch(batch, bookID)
	if err != nil { return HookRevision{}, err }
	snapshot, err := snapshotForBook(batch, book)
	if err != nil { return HookRevision{}, err }
	if snapshot.Mode != "viral" { return HookRevision{}, fmt.Errorf("%w: Hook is only available in viral mode", ErrConflict) }
	if strings.TrimSpace(book.SourceText) == "" { return HookRevision{}, fmt.Errorf("%w: source text is required", ErrInvalid) }
	contract := BuildHookContract(book)
	text, err := s.Provider.Complete(ctx, TextCompletionRequest{SystemPrompt: contract.SystemPrompt, UserPrompt: contract.UserPrompt, Temperature: contract.Temperature, MaxTokens: contract.MaxTokens})
	if err != nil { return HookRevision{}, err }
	return s.Store.CreateHookRevision(ctx, owner, batchID, bookID, strings.TrimSpace(text), sourceDigest(book.SourceText))
}

func (s *DirectorService) ApproveHook(ctx context.Context, owner, batchID, bookID, hookID string) (HookRevision, error) {
	if err := s.validate(); err != nil { return HookRevision{}, err }
	return s.Store.ApproveHookRevision(ctx, owner, batchID, bookID, hookID)
}

func (s *DirectorService) RunDirector(ctx context.Context, owner, batchID, bookID string) (DirectorRevision, error) {
	if err := s.validate(); err != nil { return DirectorRevision{}, err }
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil { return DirectorRevision{}, err }
	book, err := bookFromBatch(batch, bookID)
	if err != nil { return DirectorRevision{}, err }
	if strings.TrimSpace(book.SourceText) == "" { return DirectorRevision{}, fmt.Errorf("%w: source text is required", ErrInvalid) }
	snapshot, err := snapshotForBook(batch, book)
	if err != nil { return DirectorRevision{}, err }
	hook := HookRevision{}
	if snapshot.Mode == "viral" {
		hook, err = s.Store.LatestHookRevision(ctx, owner, batchID, bookID)
		if err != nil { return DirectorRevision{}, fmt.Errorf("%w: viral mode requires approved Hook", ErrConflict) }
		if hook.Status != "approved" { return DirectorRevision{}, fmt.Errorf("%w: viral mode requires approved Hook", ErrConflict) }
	}
	contract, err := BuildDirectorContract(book, hook, snapshot)
	if err != nil { return DirectorRevision{}, err }
	completion, err := s.Provider.Complete(ctx, TextCompletionRequest{SystemPrompt: contract.SystemPrompt, UserPrompt: contract.UserPrompt, Temperature: contract.Temperature, MaxTokens: contract.MaxTokens})
	if err != nil { return DirectorRevision{}, err }
	raw, err := ParseDirectorJSON(completion)
	if err != nil { return DirectorRevision{}, fmt.Errorf("%w: %v", ErrInvalid, err) }
	result, err := NormalizeDirectorOutput(raw, contract.Normalization)
	if err != nil { return DirectorRevision{}, fmt.Errorf("%w: %v", ErrInvalid, err) }
	return s.Store.PersistDirectorRevision(ctx, owner, book, snapshot, sourceDigest(book.SourceText), hook.ID, result)
}

