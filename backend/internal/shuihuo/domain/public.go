package domain

import "time"

// PublicTask is the browser-safe task projection. Provider request input
// snapshots stay server-side because they may contain full prompts or future
// provider-specific parameters that are not part of the public API contract.
type PublicTask struct {
	ID              int64      `json:"id"`
	ProjectID       int64      `json:"projectId"`
	SegmentID       *int64     `json:"segmentId"`
	Kind            string     `json:"kind"`
	Status          TaskStatus `json:"status"`
	Provider        string     `json:"provider"`
	ProviderTaskID  string     `json:"providerTaskId,omitempty"`
	ModelID         *int64     `json:"modelId"`
	ModelVersionID  *int64     `json:"modelVersionId"`
	PromptVersionID *int64     `json:"promptVersionId"`
	Output          string     `json:"output,omitempty"`
	ErrorCode       string     `json:"errorCode,omitempty"`
	ErrorMessage    string     `json:"errorMessage,omitempty"`
	RetryCount      int        `json:"retryCount"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

func ToPublicTask(task Task) PublicTask {
	return PublicTask{
		ID: task.ID,
		ProjectID: task.ProjectID,
		SegmentID: task.SegmentID,
		Kind: task.Kind,
		Status: task.Status,
		Provider: task.Provider,
		ProviderTaskID: task.ProviderTaskID,
		ModelID: task.ModelID,
		ModelVersionID: task.ModelVersionID,
		PromptVersionID: task.PromptVersionID,
		Output: task.Output,
		ErrorCode: task.ErrorCode,
		ErrorMessage: task.ErrorMessage,
		RetryCount: task.RetryCount,
		CreatedAt: task.CreatedAt,
		UpdatedAt: task.UpdatedAt,
	}
}
