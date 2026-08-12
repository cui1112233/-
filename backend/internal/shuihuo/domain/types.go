package domain

import (
	"errors"
	"fmt"
	"time"
)

var ErrInvalidTaskTransition = errors.New("invalid shuihuo task status transition")
var ErrInvalidTaskStatus = errors.New("invalid shuihuo task status")

type Project struct {
	ID                  int64
	UserID              int64
	Name                string
	SourceText          string
	SourceObjectKey     string
	SegmentationStatus  string
	SegmentationVersion int
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type Segment struct {
	ID                int64
	ProjectID         int64
	SourceText        string
	SubtitleText      string
	OrderIndex        int
	Confirmed         bool
	ManuallyEdited    bool
	ImagePrompt       string
	VideoPrompt       string
	ImagePromptLocked bool
	VideoPromptLocked bool
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type Asset struct {
	ID                 int64
	ProjectID          int64
	AssetTypeID        *int64
	Name               string
	Prompt             string
	ReferenceObjectKey string
	Source             string
	ManuallyEdited     bool
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type AssetType struct {
	ID        int64
	UserID    *int64
	Name      string
	Category  string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type AssetTemplate struct {
	ID          int64
	UserID      *int64
	AssetTypeID int64
	Name        string
	Prompt      string
	Source      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Media struct {
	ID             int64
	ProjectID      int64
	SegmentID      *int64
	TaskID         *int64
	Kind           string
	ObjectKey      string
	Source         string
	ManuallyEdited bool
	Width          *int
	Height         *int
	DurationMS     *int64
	IsPrimary      bool
	CreatedAt      time.Time
	UpdatedAt      time.Time
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

type TaskEvent struct {
	ID        int64
	TaskID    int64
	Status    TaskStatus
	Message   string
	CreatedAt time.Time
}
