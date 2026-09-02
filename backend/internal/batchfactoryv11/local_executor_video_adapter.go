package batchfactoryv11

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

type LocalVideoJobInput struct {
	SourceTaskID string
	BatchID      string
	BookID       string
	VideoID      string
	Model        string
	Prompt       string
	Duration     int
	AspectRatio  string
	Resolution   string
}

type LocalVideoJob struct {
	ID          string
	State       string
	ArtifactID  string
	ErrorMessage string
}

type LocalVideoJobClient interface {
	CreateVideoJob(context.Context, string, LocalVideoJobInput) (LocalVideoJob, error)
	GetVideoJob(context.Context, string, string) (LocalVideoJob, error)
}

type LocalVideoExecutorAvailability interface {
	HasOnlineVideoExecutor(context.Context, string) (bool, error)
}

type LocalExecutorVideoAdapter struct {
	Client     LocalVideoJobClient
	PublicBaseURL string
}

func NewLocalExecutorVideoAdapter(client LocalVideoJobClient, publicBaseURL string) *LocalExecutorVideoAdapter {
	return &LocalExecutorVideoAdapter{Client: client, PublicBaseURL: strings.TrimRight(strings.TrimSpace(publicBaseURL), "/")}
}

func (a *LocalExecutorVideoAdapter) EnsureAvailable(ctx context.Context, owner string) error {
	if a == nil || a.Client == nil {
		return fmt.Errorf("%w: local executor is unavailable", ErrUnavailable)
	}
	if availability, ok := a.Client.(LocalVideoExecutorAvailability); ok {
		online, err := availability.HasOnlineVideoExecutor(ctx, owner)
		if err != nil { return err }
		if !online { return fmt.Errorf("%w: no online Doubao local executor is paired", ErrUnavailable) }
	}
	return nil
}

func (a *LocalExecutorVideoAdapter) Submit(ctx context.Context, owner string, input LocalVideoJobInput) (ProviderTaskRef, error) {
	if a == nil || a.Client == nil {
		return ProviderTaskRef{}, fmt.Errorf("%w: local executor is unavailable", ErrUnavailable)
	}
	if strings.TrimSpace(owner) == "" || strings.TrimSpace(input.SourceTaskID) == "" {
		return ProviderTaskRef{}, fmt.Errorf("%w: local executor task identity is required", ErrInvalid)
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return ProviderTaskRef{}, fmt.Errorf("%w: compiled prompt is required", ErrInvalid)
	}
	job, err := a.Client.CreateVideoJob(ctx, owner, input)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	if strings.TrimSpace(job.ID) == "" {
		return ProviderTaskRef{}, fmt.Errorf("local executor did not return a job id")
	}
	return ProviderTaskRef{ProviderTaskID: job.ID, State: mapLocalVideoState(job.State)}, nil
}

func (a *LocalExecutorVideoAdapter) Poll(ctx context.Context, owner, jobID string) (ProviderTaskRef, error) {
	if a == nil || a.Client == nil {
		return ProviderTaskRef{}, fmt.Errorf("%w: local executor is unavailable", ErrUnavailable)
	}
	jobID = strings.TrimSpace(jobID)
	if jobID == "" {
		return ProviderTaskRef{}, fmt.Errorf("%w: local executor job id is required", ErrInvalid)
	}
	job, err := a.Client.GetVideoJob(ctx, owner, jobID)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	ref := ProviderTaskRef{ProviderTaskID: job.ID, State: mapLocalVideoState(job.State)}
	if ref.State == ProductionSucceeded {
		artifactID := strings.TrimSpace(job.ArtifactID)
		if artifactID == "" {
			return ProviderTaskRef{}, fmt.Errorf("local executor succeeded without an artifact")
		}
		ref.MediaURL = a.artifactURL(artifactID)
	}
	if ref.State == ProductionFailed && strings.TrimSpace(job.ErrorMessage) != "" {
		return ref, fmt.Errorf("%s", boundedProviderError(job.ErrorMessage))
	}
	return ref, nil
}

func (a *LocalExecutorVideoAdapter) artifactURL(id string) string {
	id = url.PathEscape(strings.TrimSpace(id))
	if a.PublicBaseURL == "" {
		return "/api/shuihuo-production/local-executor-artifacts/" + id
	}
	return a.PublicBaseURL + "/api/shuihuo-production/local-executor-artifacts/" + id
}

func mapLocalVideoState(state string) ProductionState {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "queued", "leased", "preparing", "submitting":
		return ProductionQueued
	case "accepted", "generating", "downloading", "uploading":
		return ProductionRunning
	case "succeeded", "success", "completed":
		return ProductionSucceeded
	case "failed", "cancelled", "canceled":
		return ProductionFailed
	default:
		return ProductionRunning
	}
}

func boundedProviderError(message string) string {
	message = strings.TrimSpace(message)
	if len(message) > 240 {
		return message[:240]
	}
	return message
}
