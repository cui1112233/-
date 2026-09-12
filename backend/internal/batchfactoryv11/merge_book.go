package batchfactoryv11

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

type BookMergeStatus struct {
	BatchID   string     `json:"batchId"`
	BookID    string     `json:"bookId"`
	RequestID string     `json:"requestId"`
	Status    MergeState `json:"status"`
	VideoJobs []MergeJob `json:"videoJobs"`
	FinalJob  *MergeJob  `json:"finalJob,omitempty"`
}

func normalizeBookMergeOptions(options MergeOptions) (MergeOptions, error) {
	options.TimingMode = strings.TrimSpace(options.TimingMode)
	if options.TimingMode == "" {
		options.TimingMode = "speed"
	}
	if options.TimingMode != "speed" && options.TimingMode != "audio" {
		return MergeOptions{}, fmt.Errorf("%w: unsupported merge timing mode", ErrInvalid)
	}
	if options.TimingMode == "speed" && options.Speed == 0 {
		options.Speed = 1
	}
	if options.Speed != 0 && (options.Speed < 0.25 || options.Speed > 4) {
		return MergeOptions{}, fmt.Errorf("%w: merge speed must be between 0.25 and 4", ErrInvalid)
	}
	if options.TimingMode == "audio" && options.AudioDurationSeconds <= 0 {
		return MergeOptions{}, fmt.Errorf("%w: audio duration is required for audio timing", ErrInvalid)
	}
	if options.TTSSpeed == 0 {
		options.TTSSpeed = 1.7
	}
	if options.TTSSpeed < 0.5 || options.TTSSpeed > 4 {
		return MergeOptions{}, fmt.Errorf("%w: tts speed must be between 0.5 and 4", ErrInvalid)
	}
	return options, nil
}

func videoMergeRequestID(rootRequestID, videoID string) string {
	return rootRequestID + ":video:" + videoID
}

func bookMergeRequestID(rootRequestID string) string {
	return rootRequestID + ":book"
}

func (s *MergeService) submitStructuredMergeJob(ctx context.Context, repository MergeRepository, owner string, job MergeJob, options MergeOptions) (MergeJob, error) {
	if existing, err := repository.FindMergeJob(ctx, owner, job.BatchID, job.RequestID); err == nil {
		return existing, nil
	} else if !errors.Is(err, ErrNotFound) {
		return MergeJob{}, err
	}
	providerSources := append([]MergeMedia(nil), job.Sources...)
	created, err := repository.CreateMergeJob(ctx, job)
	if err != nil {
		return MergeJob{}, err
	}
	result, submitErr := s.Adapter.Submit(ctx, job.BatchID, providerSources, options)
	updated := created
	updated.Status = normalizeMergeState(result.Status)
	updated.ProviderTaskID = strings.TrimSpace(result.ProviderTaskID)
	updated.OutputURL = strings.TrimSpace(result.OutputURL)
	updated.ErrorMessage = strings.TrimSpace(result.ErrorMessage)
	if submitErr != nil {
		updated.Status = MergeFailed
		updated.ErrorMessage = productionError(submitErr)
	}
	return repository.UpdateMergeJob(ctx, owner, created.ID, updated)
}

func (s *MergeService) SubmitBookMerge(ctx context.Context, owner, batchID, bookID, requestID string, options MergeOptions) (BookMergeStatus, error) {
	if s == nil || !s.Enabled {
		return BookMergeStatus{}, fmt.Errorf("%w: merge is not enabled", ErrUnavailable)
	}
	if s.Adapter == nil {
		return BookMergeStatus{}, ErrUnavailable
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return BookMergeStatus{}, fmt.Errorf("%w: request id is required", ErrInvalid)
	}
	options, err := normalizeBookMergeOptions(options)
	if err != nil {
		return BookMergeStatus{}, err
	}
	repository, err := s.repository()
	if err != nil {
		return BookMergeStatus{}, err
	}
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil {
		return BookMergeStatus{}, err
	}
	book, err := bookFromBatch(batch, bookID)
	if err != nil {
		return BookMergeStatus{}, err
	}
	if book.DirectorRevision == nil {
		return BookMergeStatus{}, fmt.Errorf("%w: active Director revision is required", ErrConflict)
	}
	productionRepository, ok := s.Store.(ProductionRepository)
	if !ok {
		return BookMergeStatus{}, ErrUnavailable
	}
	productionJobs, err := productionRepository.ListProductionJobs(ctx, owner, batchID)
	if err != nil {
		return BookMergeStatus{}, err
	}
	plan, err := BuildBookMergePlan(book, book.DirectorRevision.ID, productionJobs)
	if err != nil {
		return BookMergeStatus{}, err
	}

	status := BookMergeStatus{BatchID: batchID, BookID: bookID, RequestID: requestID, Status: MergeRunning, VideoJobs: make([]MergeJob, 0, len(plan.Videos))}
	allVideosSucceeded := true
	for _, videoPlan := range plan.Videos {
		sources := make([]MergeMedia, 0, len(videoPlan.Sources))
		for _, source := range videoPlan.Sources {
			sources = append(sources, MergeMedia{
				ProductionJobID: source.ProductionJobID,
				BookID:          source.BookID,
				VideoID:         source.VideoID,
				ShotID:          source.ShotID,
				MediaURL:        source.MediaURL,
				URL:             source.MediaURL,
				Order:           source.Order,
			})
		}
		videoOptions := MergeOptions{TimingMode: "speed", Speed: 1, TTSSpeed: options.TTSSpeed}
		now := time.Now().UTC()
		job, submitErr := s.submitStructuredMergeJob(ctx, repository, owner, MergeJob{
			Owner:         owner,
			BatchID:       batchID,
			RootRequestID: requestID,
			RequestID:     videoMergeRequestID(requestID, videoPlan.VideoID),
			BookID:       bookID,
			VideoID:      videoPlan.VideoID,
			Stage:        MergeStageVideo,
			TimingMode:   videoOptions.TimingMode,
			Speed:        videoOptions.Speed,
			TTSSpeed:     videoOptions.TTSSpeed,
			Status:       MergeQueued,
			Sources:      sources,
			CreatedAt:    now,
			UpdatedAt:    now,
		}, videoOptions)
		if submitErr != nil {
			return BookMergeStatus{}, submitErr
		}
		status.VideoJobs = append(status.VideoJobs, job)
		if job.Status == MergeFailed {
			status.Status = MergeFailed
			allVideosSucceeded = false
		} else if job.Status != MergeSucceeded || strings.TrimSpace(job.OutputURL) == "" {
			allVideosSucceeded = false
		}
	}
	if !allVideosSucceeded {
		return status, nil
	}

	finalSources := make([]MergeMedia, 0, len(status.VideoJobs))
	for index, videoJob := range status.VideoJobs {
		finalSources = append(finalSources, MergeMedia{
			ProductionJobID: videoJob.ID,
			BookID:          bookID,
			VideoID:         videoJob.VideoID,
			MediaURL:        videoJob.OutputURL,
			URL:             videoJob.OutputURL,
			Order:           index,
		})
	}
	now := time.Now().UTC()
	finalJob, err := s.submitStructuredMergeJob(ctx, repository, owner, MergeJob{
		Owner:                owner,
		BatchID:              batchID,
		RootRequestID:        requestID,
		RequestID:            bookMergeRequestID(requestID),
		BookID:               bookID,
		Stage:                MergeStageBook,
		TimingMode:           options.TimingMode,
		Speed:                options.Speed,
		TTSSpeed:             options.TTSSpeed,
		AudioDurationSeconds: options.AudioDurationSeconds,
		Status:               MergeQueued,
		Sources:              finalSources,
		CreatedAt:            now,
		UpdatedAt:            now,
	}, options)
	if err != nil {
		return BookMergeStatus{}, err
	}
	status.FinalJob = &finalJob
	status.Status = finalJob.Status
	return status, nil
}
