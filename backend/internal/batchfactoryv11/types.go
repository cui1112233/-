package batchfactoryv11

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("revision conflict")
	ErrInvalid  = errors.New("invalid input")
)

type SettingsPatch map[string]json.RawMessage

type ScopeKind string

const (
	ScopeBatch ScopeKind = "batch"
	ScopeBook  ScopeKind = "book"
	ScopeVideo ScopeKind = "video"
)

type ScopeRef struct {
	Kind    ScopeKind `json:"kind"`
	BatchID string    `json:"batchId"`
	BookID  string    `json:"bookId,omitempty"`
	VideoID string    `json:"videoId,omitempty"`
}
type SettingsUpdate struct {
	Patch            SettingsPatch `json:"patch"`
	RestoreKeys      []string      `json:"restoreKeys,omitempty"`
	ExpectedRevision int64         `json:"expectedRevision"`
}
type SettingsResult struct {
	Scope    ScopeRef        `json:"scope"`
	Patch    SettingsPatch   `json:"patch"`
	Revision int64           `json:"revision"`
	Snapshot *ConfigSnapshot `json:"snapshot,omitempty"`
}

type Video struct {
	ID                 string  `json:"id"`
	BatchID            string  `json:"batchId"`
	BookID             string  `json:"bookId"`
	Label              string  `json:"label,omitempty"`
	VisualPrompt       string  `json:"visualPrompt,omitempty"`
	DurationSeconds    float64 `json:"durationSeconds,omitempty"`
	CompatibilityState string  `json:"compatibilityState"`
	Revision           int64   `json:"revision"`
}
type Book struct {
	ID         string  `json:"id"`
	BatchID    string  `json:"batchId"`
	BookID     string  `json:"bookId"`
	Title      string  `json:"title"`
	SourceText string  `json:"sourceText,omitempty"`
	Revision   int64   `json:"revision"`
	Videos     []Video `json:"videos"`
}
type Batch struct {
	ID             string    `json:"id"`
	Title          string    `json:"title"`
	SourceIntakeID string    `json:"sourceIntakeId,omitempty"`
	Revision       int64     `json:"revision"`
	Books          []Book    `json:"books"`
	CreatedAt      time.Time `json:"createdAt,omitempty"`
	UpdatedAt      time.Time `json:"updatedAt,omitempty"`
}
type CreateVideoInput struct {
	Label           string  `json:"label"`
	VisualPrompt    string  `json:"visualPrompt,omitempty"`
	DurationSeconds float64 `json:"durationSeconds,omitempty"`
}
type CreateBookInput struct {
	ID         string             `json:"id,omitempty"`
	Title      string             `json:"title"`
	SourceText string             `json:"sourceText,omitempty"`
	Videos     []CreateVideoInput `json:"videos,omitempty"`
}
type CreateBatchInput struct {
	Title string            `json:"title"`
	Books []CreateBookInput `json:"books,omitempty"`
}
type Intake struct {
	ID         string          `json:"id"`
	Owner      string          `json:"-"`
	Payload    json.RawMessage `json:"payload"`
	ConsumedAt *time.Time      `json:"consumedAt,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
}
type NovelFetchIntakeInput struct {
	Books    []CreateBookInput `json:"books"`
	Metadata map[string]any    `json:"metadata,omitempty"`
}
type ConfigVersion struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Config    json.RawMessage `json:"config"`
	CreatedAt time.Time       `json:"createdAt,omitempty"`
}
type ConfigSnapshot struct {
	ID        string        `json:"id"`
	BatchID   string        `json:"batchId"`
	BookID    string        `json:"bookId,omitempty"`
	VideoID   string        `json:"videoId,omitempty"`
	Effective SettingsPatch `json:"effective"`
	CreatedAt time.Time     `json:"createdAt"`
}
type ChangeImpact struct {
	AffectedBooks       int      `json:"affectedBooks"`
	AffectedVideos      int      `json:"affectedVideos"`
	InvalidatesDirector bool     `json:"invalidatesDirector"`
	PreservesOverrides  bool     `json:"preservesOverrides"`
	ChangedKeys         []string `json:"changedKeys"`
}
type Prompt struct {
	ID        string    `json:"id"`
	VersionID string    `json:"versionId"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	Content   string    `json:"content"`
	Revision  int64     `json:"revision"`
	CreatedAt time.Time `json:"createdAt"`
}
type Draft struct {
	Key       string    `json:"key"`
	Kind      string    `json:"kind"`
	Scope     string    `json:"scope"`
	Content   string    `json:"content"`
	Revision  int64     `json:"revision"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Store interface {
	CreateIntake(context.Context, string, NovelFetchIntakeInput) (Intake, error)
	GetIntake(context.Context, string, string) (Intake, error)
	CreateBatchFromIntake(context.Context, string, string, CreateBatchInput) (Batch, error)
	CreateBatch(context.Context, string, CreateBatchInput) (Batch, error)
	ListBatches(context.Context, string) ([]Batch, error)
	GetBatch(context.Context, string, string) (Batch, error)
	SaveSettings(context.Context, string, ScopeRef, SettingsUpdate) (SettingsResult, error)
	ConfigVersions(context.Context, string) ([]ConfigVersion, error)
	ChangeImpact(context.Context, string, string, SettingsUpdate) (ChangeImpact, error)
	ListPrompts(context.Context, string, string) ([]Prompt, error)
	CreatePrompt(context.Context, string, Prompt) (Prompt, error)
	GetDraft(context.Context, string, string, string, string) (Draft, error)
	SaveDraft(context.Context, string, Draft) (Draft, error)
}
