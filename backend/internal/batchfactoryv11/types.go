package batchfactoryv11

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrNotFound    = errors.New("not found")
	ErrConflict    = errors.New("revision conflict")
	ErrInvalid     = errors.New("invalid input")
	ErrUnavailable = errors.New("capability unavailable")
)

type SettingsPatch map[string]json.RawMessage

type SettingsState struct {
	Patch    SettingsPatch `json:"patch"`
	Revision int64         `json:"revision"`
}

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
	ID                 string        `json:"id"`
	BatchID            string        `json:"batchId"`
	BookID             string        `json:"bookId"`
	Label              string        `json:"label,omitempty"`
	VisualPrompt       string        `json:"visualPrompt,omitempty"`
	DurationSeconds    float64       `json:"durationSeconds,omitempty"`
	CompatibilityState string        `json:"compatibilityState"`
	Revision           int64         `json:"revision"`
	SettingsState      SettingsState `json:"settingsState"`
}
type Book struct {
	ID               string            `json:"id"`
	BatchID          string            `json:"batchId"`
	BookID           string            `json:"bookId"`
	Title            string            `json:"title"`
	SourceText       string            `json:"sourceText,omitempty"`
	ContentPreview   string            `json:"contentPreview,omitempty"`
	ContentLineLimit int               `json:"contentLineLimit,omitempty"`
	ContentLineCount int               `json:"contentLineCount,omitempty"`
	SourceTaskID     string            `json:"sourceTaskId,omitempty"`
	Platform         string            `json:"platform,omitempty"`
	Gender           string            `json:"gender,omitempty"`
	Type             string            `json:"type,omitempty"`
	SourceLabel      string            `json:"sourceLabel,omitempty"`
	TxtText          string            `json:"txtText,omitempty"`
	TxtFileName      string            `json:"txtFileName,omitempty"`
	SourceMetadata   map[string]any    `json:"sourceMetadata,omitempty"`
	Revision         int64             `json:"revision"`
	SettingsState    SettingsState     `json:"settingsState"`
	Mode             string            `json:"mode,omitempty"`
	Hook             *HookRevision     `json:"hook,omitempty"`
	DirectorRevision *DirectorRevision `json:"directorRevision,omitempty"`
	Assets           DirectorAssets    `json:"assets,omitempty"`
	Videos           []Video           `json:"videos"`
}
type Batch struct {
	ID             string        `json:"id"`
	Title          string        `json:"title"`
	SourceIntakeID string        `json:"sourceIntakeId,omitempty"`
	Revision       int64         `json:"revision"`
	SettingsState  SettingsState `json:"settingsState"`
	Books          []Book        `json:"books"`
	CreatedAt      time.Time     `json:"createdAt,omitempty"`
	UpdatedAt      time.Time     `json:"updatedAt,omitempty"`
}
type CreateVideoInput struct {
	Label           string  `json:"label"`
	VisualPrompt    string  `json:"visualPrompt,omitempty"`
	DurationSeconds float64 `json:"durationSeconds,omitempty"`
}
type CreateBookInput struct {
	ID             string             `json:"id,omitempty"`
	BookID         string             `json:"bookId,omitempty"`
	SourceTaskID   string             `json:"sourceTaskId,omitempty"`
	Title          string             `json:"title"`
	Platform       string             `json:"platform,omitempty"`
	SourceText     string             `json:"sourceText,omitempty"`
	TxtText        string             `json:"txtText,omitempty"`
	TxtFileName    string             `json:"txtFileName,omitempty"`
	SourceMetadata map[string]any     `json:"sourceMetadata,omitempty"`
	Videos         []CreateVideoInput `json:"videos,omitempty"`
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
type ManualIntakeInput struct {
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

type HookRevision struct {
	ID           string     `json:"id"`
	BatchID      string     `json:"batchId"`
	BookID       string     `json:"bookId"`
	Revision     int64      `json:"revision"`
	Status       string     `json:"status"`
	Text         string     `json:"text"`
	SourceDigest string     `json:"sourceDigest"`
	CreatedAt    time.Time  `json:"createdAt"`
	ApprovedAt   *time.Time `json:"approvedAt,omitempty"`
}

type DirectorAssets struct {
	Characters []NamedPrompt `json:"characters"`
	Scenes     []NamedPrompt `json:"scenes"`
	Props      []NamedPrompt `json:"props"`
}

type OrphanedOverride struct {
	VideoID string        `json:"videoId"`
	Patch   SettingsPatch `json:"patch"`
	State   string        `json:"state"`
}

type DirectorRevision struct {
	ID                string             `json:"id"`
	BatchID           string             `json:"batchId"`
	BookID            string             `json:"bookId"`
	Revision          int64              `json:"revision"`
	Mode              string             `json:"mode"`
	SnapshotID        string             `json:"snapshotId"`
	SourceDigest      string             `json:"sourceDigest"`
	HookRevisionID    string             `json:"hookRevisionId,omitempty"`
	Output            DirectorResult     `json:"output"`
	Videos            []Video            `json:"videos"`
	OrphanedOverrides []OrphanedOverride `json:"orphanedOverrides,omitempty"`
	CreatedAt         time.Time          `json:"createdAt"`
}

type HookRunInput struct {
	BatchID string `json:"batchId"`
	BookID  string `json:"bookId"`
}

type DirectorRunInput struct {
	BatchID string `json:"batchId"`
	BookID  string `json:"bookId"`
}

type DirectorSnapshot struct {
	Effective        SettingsPatch `json:"effective"`
	Mode             string        `json:"mode"`
	MaxVideoDuration int           `json:"maxVideoDuration"`
	FixedSingleVideo bool          `json:"fixedSingleVideo"`
	ExactDuration    int           `json:"exactDuration"`
	AspectRatio      string        `json:"aspectRatio"`
}

type Store interface {
	CreateIntake(context.Context, string, NovelFetchIntakeInput) (Intake, error)
	CreateManualIntake(context.Context, string, ManualIntakeInput) (Intake, error)
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
	CreateHookRevision(context.Context, string, string, string, string, string) (HookRevision, error)
	ApproveHookRevision(context.Context, string, string, string, string) (HookRevision, error)
	LatestHookRevision(context.Context, string, string, string) (HookRevision, error)
	PersistDirectorRevision(context.Context, string, Book, DirectorSnapshot, string, string, DirectorResult) (DirectorRevision, error)
}
