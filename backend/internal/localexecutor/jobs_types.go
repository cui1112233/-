package localexecutor

import (
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrNoClaimableJob    = errors.New("no claimable local executor job")
	ErrJobNotFound       = errors.New("local executor job not found")
	ErrStaleLease        = errors.New("stale local executor job lease")
	ErrJobCancelled      = errors.New("local executor job cancelled")
	ErrAcceptedJobPinned = errors.New("accepted local executor job is pinned")
	ErrInvalidJobState   = errors.New("invalid local executor job state")
	ErrJobConflict       = errors.New("local executor job conflict")
)

const JobLeaseTTL = 60 * time.Second

type JobState string

const (
	JobQueued            JobState = "queued"
	JobLeased            JobState = "leased"
	JobPreparing         JobState = "preparing"
	JobSubmitting        JobState = "submitting"
	JobAcceptanceUnknown JobState = "acceptance_unknown"
	JobAccepted          JobState = "accepted"
	JobGenerating        JobState = "generating"
	JobDownloading       JobState = "downloading"
	JobUploading         JobState = "uploading"
	JobSucceeded         JobState = "succeeded"
	JobFailed            JobState = "failed"
	JobCancelled         JobState = "cancelled"
)

type CreateJobInput struct {
	SourceTaskID string         `json:"sourceTaskId"`
	Platform     string         `json:"platform"`
	Payload      map[string]any `json:"payload"`
}

type LeaseCredential struct {
	Token      string `json:"leaseToken"`
	Generation int64  `json:"leaseGeneration"`
}

type AcceptanceInput struct {
	AccountID    string `json:"accountId"`
	SubmissionID string `json:"submissionId"`
}

type FailureInput struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type ResultInput struct {
	ArtifactID string `json:"artifactId"`
}

type JobRecord struct {
	ID                string
	OwnerUsername     string
	SourceTaskID      string
	Platform          string
	Payload           json.RawMessage
	State             JobState
	CancelRequested   bool
	LeaseExecutorID   string
	LeaseTokenHash    SecretHash
	LeaseGeneration   int64
	LeaseExpiresAt    *time.Time
	AcceptedAt        *time.Time
	AcceptedAccountID string
	SubmissionID      string
	ArtifactID        string
	ErrorCode         string
	ErrorMessage      string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type JobView struct {
	ID                string          `json:"id"`
	SourceTaskID      string          `json:"sourceTaskId"`
	Platform          string          `json:"platform"`
	Payload           json.RawMessage `json:"payload"`
	State             JobState        `json:"state"`
	CancelRequested   bool            `json:"cancelRequested"`
	LeaseExecutorID   string          `json:"leaseExecutorId,omitempty"`
	LeaseGeneration   int64           `json:"leaseGeneration"`
	LeaseExpiresAt    *time.Time      `json:"leaseExpiresAt,omitempty"`
	AcceptedAt        *time.Time      `json:"acceptedAt,omitempty"`
	AcceptedAccountID string          `json:"acceptedAccountId,omitempty"`
	SubmissionID      string          `json:"submissionId,omitempty"`
	ArtifactID        string          `json:"artifactId,omitempty"`
	ErrorCode         string          `json:"errorCode,omitempty"`
	ErrorMessage      string          `json:"errorMessage,omitempty"`
	CreatedAt         time.Time       `json:"createdAt"`
	UpdatedAt         time.Time       `json:"updatedAt"`
}

type ClaimResult struct {
	Job             JobView   `json:"job"`
	LeaseToken      string    `json:"leaseToken"`
	LeaseGeneration int64     `json:"leaseGeneration"`
	LeaseExpiresAt  time.Time `json:"leaseExpiresAt"`
}

type LeaseView struct {
	LeaseGeneration int64     `json:"leaseGeneration"`
	LeaseExpiresAt  time.Time `json:"leaseExpiresAt"`
}
