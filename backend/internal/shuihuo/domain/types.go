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
	UserID              int64     `json:"userId"`
	Name                string    `json:"name"`
	SourceText          string    `json:"sourceText"`
	SourceObjectKey     string    `json:"sourceObjectKey"`
	SegmentationStatus  string    `json:"segmentationStatus"`
	SegmentationVersion int       `json:"segmentationVersion"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

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
	JianyingDraftDirectory string `json:"jianyingDraftDirectory"`
}

type Segment struct {
	ID                int64     `json:"id"`
	ProjectID         int64     `json:"projectId"`
	SourceText        string    `json:"sourceText"`
	SubtitleText      string    `json:"subtitleText"`
	OrderIndex        int       `json:"orderIndex"`
	Confirmed         bool      `json:"confirmed"`
	ManuallyEdited    bool      `json:"manuallyEdited"`
	ImagePrompt       string    `json:"imagePrompt"`
	VideoPrompt       string    `json:"videoPrompt"`
	ImagePromptLocked bool      `json:"imagePromptLocked"`
	VideoPromptLocked bool      `json:"videoPromptLocked"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type Asset struct {
	ID                 int64     `json:"id"`
	ProjectID          int64     `json:"projectId"`
	AssetTypeID        *int64    `json:"assetTypeId"`
	Category           string    `json:"category"`
	Name               string    `json:"name"`
	Prompt             string    `json:"prompt"`
	ReferenceObjectKey string    `json:"referenceObjectKey"`
	Source             string    `json:"source"`
	ManuallyEdited     bool      `json:"manuallyEdited"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type SegmentAsset struct {
	SegmentID int64 `json:"segmentId"`
	AssetID   int64 `json:"assetId"`
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
	ObjectKey      string    `json:"objectKey"`
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
	ID              int64      `json:"id"`
	UserID          int64      `json:"-"`
	ProjectID       int64      `json:"projectId"`
	SegmentID       *int64     `json:"segmentId"`
	Kind            string     `json:"kind"`
	Status          TaskStatus `json:"status"`
	Provider        string     `json:"provider"`
	ProviderTaskID  string     `json:"providerTaskId"`
	ModelID         *int64     `json:"modelId"`
	ModelVersionID  *int64     `json:"modelVersionId"`
	PromptVersionID *int64     `json:"promptVersionId"`
	Input           string     `json:"input"`
	Output          string     `json:"output"`
	ErrorCode       string     `json:"errorCode"`
	ErrorMessage    string     `json:"errorMessage"`
	RetryCount      int        `json:"retryCount"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

type TaskEvent struct {
	ID        int64
	TaskID    int64
	Status    TaskStatus
	Message   string
	CreatedAt time.Time
}
// AssetGenerationConfig is the project-scoped preset selection used for asset
// generation. It contains only safe identifiers and display choices.
type AssetGenerationConfig struct {
	ProjectID             int64     `json:"projectId"`
	TextModelID           *int64    `json:"textModelId"`
	ImageModelID          *int64    `json:"imageModelId"`
	AudioModelID          *int64    `json:"audioModelId"`
	PromptTemplateID      *int64    `json:"promptTemplateId"`
	CharacterPresetID     *string   `json:"characterPresetId"`
	ScenePresetID         *string   `json:"scenePresetId"`
	AspectRatio           string    `json:"aspectRatio"`
	StyleReferenceMediaID *int64    `json:"styleReferenceMediaId"`
	ThreeView             bool      `json:"threeView"`
	UpdatedAt             time.Time `json:"updatedAt"`
}
