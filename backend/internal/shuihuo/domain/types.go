package domain

import (
	"errors"
	"fmt"
	"time"
)

var ErrInvalidTaskTransition = errors.New("invalid shuihuo task status transition")
var ErrInvalidTaskStatus = errors.New("invalid shuihuo task status")

type Project struct {
	ID                  int64     `json:"id"`
	UserID              int64     `json:"-"`
	Name                string    `json:"name"`
	SourceText          string    `json:"sourceText"`
	SourceObjectKey     string    `json:"-"`
	SegmentationStatus  string    `json:"segmentationStatus"`
	SegmentationVersion int       `json:"segmentationVersion"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

// UserProductionConfig stores optional per-account defaults used by existing
// production configuration screens. It intentionally contains IDs and text
// fragments only; credentials and provider transport settings remain server
// configuration.
type UserProductionConfig struct {
	UserID                 int64  `json:"-"`
	CharacterPrefix        string `json:"characterPrefix"`
	ImagePrefix            string `json:"imagePrefix"`
	ImageSuffix            string `json:"imageSuffix"`
	VideoPrefix            string `json:"videoPrefix"`
	VideoSuffix            string `json:"videoSuffix"`
	TextModelID            *int64 `json:"textModelId"`
	ImageModelID           *int64 `json:"imageModelId"`
	VideoModelID           *int64 `json:"videoModelId"`
	AudioModelID           *int64 `json:"audioModelId"`
	JianyingDraftDirectory string `json:"jianyingDraftDirectory"`
}

type Segment struct {
	ID                   int64     `json:"id"`
	ProjectID            int64     `json:"projectId"`
	SourceText           string    `json:"sourceText"`
	SubtitleText         string    `json:"subtitleText"`
	Speaker              string    `json:"speaker"`
	OrderIndex           int       `json:"orderIndex"`
	Confirmed            bool      `json:"confirmed"`
	ManuallyEdited       bool      `json:"manuallyEdited"`
	ImagePrompt          string    `json:"imagePrompt"`
	VideoPrompt          string    `json:"videoPrompt"`
	NegativePrompt       string    `json:"negativePrompt"`
	ImagePromptLocked    bool      `json:"imagePromptLocked"`
	VideoPromptLocked    bool      `json:"videoPromptLocked"`
	NegativePromptLocked bool      `json:"negativePromptLocked"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

// SourceUnit is the durable, ordered source text behind one or more storyboards.
// Segment.SourceText remains a compatibility cache for existing callers.
type SourceUnit struct {
	ID                  int64     `json:"id"`
	ProjectID           int64     `json:"projectId"`
	Text                string    `json:"text"`
	SourceKind          string    `json:"sourceKind"`
	SegmentationVersion int       `json:"segmentationVersion"`
	SourceOrder         int       `json:"sourceOrder"`
	CreatedAt           time.Time `json:"createdAt"`
}

// ProjectReadModel is the consistent project snapshot consumed by the
// commentary workbench. Its source-unit mappings only reference the enclosed
// active segments and source units.
type ProjectReadModel struct {
	Project              Project
	Segments             []Segment
	SourceUnits          []SourceUnit
	SegmentSourceUnitIDs map[int64][]int64
	Assets               []Asset
	SegmentAssetIDs      map[int64][]int64
	Media                []Media
}

// ObjectCleanup is a durable deletion request for an object that could not be
// removed synchronously. It deliberately has no project foreign key because
// compensation can run after a failed import deletes the project row.
type ObjectCleanup struct {
	ID             int64
	ObjectKey      string
	Reason         string
	LastError      string
	AttemptCount   int
	CreatedAt      time.Time
	LastAttemptAt  *time.Time
	LeaseToken     string     `json:"-"`
	LeaseExpiresAt *time.Time `json:"-"`
}

// ImportCleanup is a durable compensation request for an import that failed
// after its staging project was created. Staging projects are hidden from the
// normal workbench until their source object is attached successfully.
type ImportCleanup struct {
	ProjectID     int64
	UserID        int64
	ObjectKey     string
	Reason        string
	LastError     string
	AttemptCount  int
	CreatedAt     time.Time
	LastAttemptAt *time.Time
}

type StoryboardSourceMapping struct {
	SegmentID     int64
	SourceUnitID  int64
	PositionIndex int
}

// HistoricalStoryboard restores a confirmed storyboard version without
// reintroducing it into the active workbench.
type HistoricalStoryboard struct {
	SegmentID   int64
	OrderIndex  int
	SourceUnits []HistoricalStoryboardSourceUnit
}

// HistoricalStoryboardSourceUnit preserves the source text and its position
// within an archived storyboard row.
type HistoricalStoryboardSourceUnit struct {
	ID            int64
	Text          string
	PositionIndex int
}

type Asset struct {
	ID                 int64     `json:"id"`
	ProjectID          int64     `json:"projectId"`
	AssetTypeID        *int64    `json:"assetTypeId"`
	Category           string    `json:"category"`
	Name               string    `json:"name"`
	Prompt             string    `json:"prompt"`
	VoiceAssetID       *int64    `json:"voiceAssetId"`
	ReferenceObjectKey string    `json:"referenceObjectKey"`
	Source             string    `json:"source"`
	ManuallyEdited     bool      `json:"manuallyEdited"`
	IsCurrent          bool      `json:"isCurrent"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

// AssetGenerationConfig is the project-scoped preset selection used for asset
// generation. It contains only safe identifiers and display choices.
type AssetGenerationConfig struct {
	ProjectID              int64     `json:"projectId"`
	TextModelID            *int64    `json:"textModelId"`
	ImageModelID           *int64    `json:"imageModelId"`
	AudioModelID           *int64    `json:"audioModelId"`
	PromptTemplateID       *int64    `json:"promptTemplateId"`
	CharacterPresetID      *string   `json:"characterPresetId"`
	ScenePresetID          *string   `json:"scenePresetId"`
	StyleID                *int64    `json:"styleId"`
	CharacterSheetPresetID *string   `json:"characterSheetPresetId"`
	AspectRatio            string    `json:"aspectRatio"`
	StyleReferenceMediaID  *int64    `json:"styleReferenceMediaId"`
	ThreeView              bool      `json:"threeView"`
	UpdatedAt              time.Time `json:"updatedAt"`
}

// AssetStyle is a project-local image-generation style. Its prompt and
// optional reference media are never copied into unrelated projects.
type AssetStyle struct {
	ID               int64     `json:"id"`
	ProjectID        int64     `json:"projectId"`
	Name             string    `json:"name"`
	Prompt           string    `json:"prompt"`
	ReferenceMediaID *int64    `json:"referenceMediaId"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

// AssetImage is a generated reference image for one project asset. It is not
// a storyboard media record and therefore can never replace a segment image.
type AssetImage struct {
	ID                    int64     `json:"id"`
	ProjectID             int64     `json:"projectId"`
	AssetID               int64     `json:"assetId"`
	TaskID                *int64    `json:"taskId"`
	ObjectKey             string    `json:"-"`
	IsPrimary             bool      `json:"isPrimary"`
	AssetNameSnapshot     string    `json:"assetNameSnapshot"`
	AssetCategorySnapshot string    `json:"assetCategorySnapshot"`
	AssetPromptSnapshot   string    `json:"assetPromptSnapshot"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type AssetType struct {
	ID        int64     `json:"id"`
	UserID    *int64    `json:"-"`
	Name      string    `json:"name"`
	Category  string    `json:"category"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type AssetTemplate struct {
	ID                 int64     `json:"id"`
	UserID             *int64    `json:"-"`
	AssetTypeID        int64     `json:"assetTypeId"`
	Name               string    `json:"name"`
	Prompt             string    `json:"prompt"`
	ReferenceObjectKey string    `json:"referenceObjectKey"`
	Source             string    `json:"source"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type Media struct {
	ID             int64     `json:"id"`
	ProjectID      int64     `json:"projectId"`
	SegmentID      *int64    `json:"segmentId"`
	TaskID         *int64    `json:"taskId"`
	Kind           string    `json:"kind"`
	ObjectKey      string    `json:"-"`
	Source         string    `json:"source"`
	ManuallyEdited bool      `json:"manuallyEdited"`
	Width          *int      `json:"width"`
	Height         *int      `json:"height"`
	DurationMS     *int64    `json:"durationMs"`
	IsPrimary      bool      `json:"isPrimary"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type TaskStatus string

const (
	TaskDraft     TaskStatus = "draft"
	TaskQueued    TaskStatus = "queued"
	TaskRunning   TaskStatus = "running"
	TaskSucceeded TaskStatus = "succeeded"
	TaskFailed    TaskStatus = "failed"
	TaskCancelled TaskStatus = "cancelled"
)

func ValidateTaskStatus(status TaskStatus) error {
	switch status {
	case TaskDraft, TaskQueued, TaskRunning, TaskSucceeded, TaskFailed, TaskCancelled:
		return nil
	default:
		return fmt.Errorf("%w: %q", ErrInvalidTaskStatus, status)
	}
}

func (s TaskStatus) CanTransitionTo(next TaskStatus) bool {
	return map[TaskStatus]map[TaskStatus]bool{
		TaskDraft:   {TaskQueued: true, TaskCancelled: true},
		TaskQueued:  {TaskRunning: true, TaskCancelled: true},
		TaskRunning: {TaskSucceeded: true, TaskFailed: true, TaskCancelled: true},
	}[s][next]
}

func ValidateTaskTransition(current, next TaskStatus) error {
	if current.CanTransitionTo(next) {
		return nil
	}
	return fmt.Errorf("%w: %s -> %s", ErrInvalidTaskTransition, current, next)
}

type Task struct {
	ID              int64
	UserID          int64
	ProjectID       int64
	SegmentID       *int64
	Kind            string
	Status          TaskStatus
	Provider        string
	ProviderTaskID  string
	ModelID         *int64
	ModelVersionID  *int64
	PromptVersionID *int64
	Input           string
	Output          string
	ErrorCode       string
	ErrorMessage    string
	RetryCount      int
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// PublicTask is the browser contract. Task input/output snapshots can contain
// provider-specific request data and must never leave the server.
type PublicTask struct {
	ID             int64      `json:"id"`
	ProjectID      int64      `json:"projectId"`
	SegmentID      *int64     `json:"segmentId"`
	Kind           string     `json:"kind"`
	Status         TaskStatus `json:"status"`
	Provider       string     `json:"provider"`
	ProviderTaskID string     `json:"providerTaskId,omitempty"`
	ErrorCode      string     `json:"errorCode,omitempty"`
	ErrorMessage   string     `json:"errorMessage,omitempty"`
	RetryCount     int        `json:"retryCount"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

func ToPublicTask(task Task) PublicTask {
	return PublicTask{ID: task.ID, ProjectID: task.ProjectID, SegmentID: task.SegmentID, Kind: task.Kind, Status: task.Status, Provider: task.Provider, ProviderTaskID: task.ProviderTaskID, ErrorCode: task.ErrorCode, ErrorMessage: task.ErrorMessage, RetryCount: task.RetryCount, CreatedAt: task.CreatedAt, UpdatedAt: task.UpdatedAt}
}

type TaskEvent struct {
	ID        int64
	TaskID    int64
	Status    TaskStatus
	Message   string
	CreatedAt time.Time
}
