package app

import (
	"context"

	"qiantie/backend/internal/batchfactoryv11"
	"qiantie/backend/internal/localexecutor"
)

type localVideoJobClient struct {
	service *localexecutor.Service
}

func (c *localVideoJobClient) CreateVideoJob(ctx context.Context, owner string, input batchfactoryv11.LocalVideoJobInput) (batchfactoryv11.LocalVideoJob, error) {
	if c == nil || c.service == nil {
		return batchfactoryv11.LocalVideoJob{}, localexecutor.ErrInvalidInput
	}
	view, err := c.service.CreateJob(ctx, owner, localexecutor.CreateJobInput{
		SourceTaskID: input.SourceTaskID,
		Platform:     localexecutor.PlatformDoubao,
		Payload: map[string]any{
			"batchId": input.BatchID,
			"bookId": input.BookID,
			"videoId": input.VideoID,
			"model": input.Model,
			"prompt": input.Prompt,
			"duration": input.Duration,
			"aspectRatio": input.AspectRatio,
			"resolution": input.Resolution,
		},
	})
	if err != nil {
		return batchfactoryv11.LocalVideoJob{}, err
	}
	return batchfactoryv11.LocalVideoJob{ID: view.ID, State: string(view.State), ArtifactID: view.ArtifactID, ErrorMessage: view.ErrorMessage}, nil
}

func (c *localVideoJobClient) HasOnlineVideoExecutor(ctx context.Context, owner string) (bool, error) {
	if c == nil || c.service == nil {
		return false, localexecutor.ErrInvalidInput
	}
	executors, err := c.service.List(ctx, owner)
	if err != nil { return false, err }
	for _, executor := range executors {
		if executor.Platform == localexecutor.PlatformDoubao && executor.Online && executor.Accounts.Available > 0 { return true, nil }
	}
	return false, nil
}

func (c *localVideoJobClient) GetVideoJob(ctx context.Context, owner, id string) (batchfactoryv11.LocalVideoJob, error) {
	if c == nil || c.service == nil {
		return batchfactoryv11.LocalVideoJob{}, localexecutor.ErrInvalidInput
	}
	view, err := c.service.GetJob(ctx, owner, id)
	if err != nil {
		return batchfactoryv11.LocalVideoJob{}, err
	}
	return batchfactoryv11.LocalVideoJob{ID: view.ID, State: string(view.State), ArtifactID: view.ArtifactID, ErrorMessage: view.ErrorMessage}, nil
}
