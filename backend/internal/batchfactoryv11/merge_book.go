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

func aggregateBookMergeState(job MergeJob) MergeState {
	switch job.Status {
	case MergeSucceeded:
		return MergeSucceeded
	case MergeFailed:
		return MergeFailed
	default:
		return MergeRunning
	}
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

func (s *MergeService) pollStructuredMergeJob(ctx context.Context, repository MergeRepository, owner, batchID string, job MergeJob) (MergeJob, error) {
	if s.Poller == nil || strings.TrimSpace(job.ProviderTaskID) == "" || (job.Status != MergeQueued && job.Status != MergeRunning) {
		return job, nil
	}
	result, err := s.Poller.Poll(ctx, batchID, job)
	if err != nil {
		return job, nil
	}
	updated := job
	updated.Status = normalizeMergeState(result.Status)
	if value := strings.TrimSpace(result.ProviderTaskID); value != "" {
		updated.ProviderTaskID = value
	}
	updated.OutputURL = strings.TrimSpace(result.OutputURL)
	updated.ErrorMessage = strings.TrimSpace(result.ErrorMessage)
	return repository.UpdateMergeJob(ctx, owner, job.ID, updated)
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
			Owner:                owner,
			BatchID:              batchID,
			RootRequestID:        requestID,
			RequestID:            videoMergeRequestID(requestID, videoPlan.VideoID),
			BookID:               bookID,
			VideoID:              videoPlan.VideoID,
			Stage:                MergeStageVideo,
			// Persist the root Book timing envelope on every VIDEO child so a
			// fresh service process can reconstruct the final Book job without
			// relying on in-memory orchestration state. The provider still gets
			// videoOptions below, so Shot→VIDEO itself always stays at 1x.
			TimingMode:           options.TimingMode,
			Speed:                options.Speed,
			TTSSpeed:             options.TTSSpeed,
			AudioDurationSeconds: options.AudioDurationSeconds,
			Status:               MergeQueued,
			Sources:              sources,
			CreatedAt:            now,
			UpdatedAt:            now,
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
	status.Status = aggregateBookMergeState(finalJob)
	return status, nil
}

// GetBookMergeStatus reconstructs hierarchical merge progress entirely from
// durable repository state. This is intentionally safe across process restarts:
// deterministic child request IDs prevent duplicate VIDEO or Book submissions.
func (s *MergeService) GetBookMergeStatus(ctx context.Context, owner, batchID, bookID, requestID string) (BookMergeStatus, error) {
	if s == nil || !s.Enabled {
		return BookMergeStatus{}, fmt.Errorf("%w: merge is not enabled", ErrUnavailable)
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return BookMergeStatus{}, fmt.Errorf("%w: request id is required", ErrInvalid)
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
	if len(book.Videos) == 0 {
		return BookMergeStatus{}, fmt.Errorf("%w: book has no VIDEO units", ErrConflict)
	}

	status := BookMergeStatus{
		BatchID:   batchID,
		BookID:    bookID,
		RequestID: requestID,
		Status:    MergeRunning,
		VideoJobs: make([]MergeJob, 0, len(book.Videos)),
	}
	allVideosSucceeded := true
	var recoveredOptions MergeOptions
	for index, video := range book.Videos {
		job, findErr := repository.FindMergeJob(ctx, owner, batchID, videoMergeRequestID(requestID, video.ID))
		if findErr != nil {
			if errors.Is(findErr, ErrNotFound) {
				return BookMergeStatus{}, fmt.Errorf("%w: VIDEO merge job %s is missing", ErrConflict, video.ID)
			}
			return BookMergeStatus{}, findErr
		}
		if job.Stage != MergeStageVideo || job.BookID != bookID || job.VideoID != video.ID || job.RootRequestID != requestID {
			return BookMergeStatus{}, fmt.Errorf("%w: VIDEO merge identity mismatch", ErrConflict)
		}
		job, err = s.pollStructuredMergeJob(ctx, repository, owner, batchID, job)
		if err != nil {
			return BookMergeStatus{}, err
		}
		status.VideoJobs = append(status.VideoJobs, job)
		options := MergeOptions{
			TimingMode:           job.TimingMode,
			Speed:                job.Speed,
			TTSSpeed:             job.TTSSpeed,
			AudioDurationSeconds: job.AudioDurationSeconds,
		}
		if index == 0 {
			recoveredOptions = options
		} else if options != recoveredOptions {
			return BookMergeStatus{}, fmt.Errorf("%w: VIDEO merge timing metadata mismatch", ErrConflict)
		}
		if job.Status == MergeFailed {
			status.Status = MergeFailed
			allVideosSucceeded = false
		} else if job.Status != MergeSucceeded || strings.TrimSpace(job.OutputURL) == "" {
			allVideosSucceeded = false
		}
	}
	if status.Status == MergeFailed || !allVideosSucceeded {
		return status, nil
	}

	recoveredOptions, err = normalizeBookMergeOptions(recoveredOptions)
	if err != nil {
		return BookMergeStatus{}, fmt.Errorf("%w: persisted Book merge timing is invalid", ErrConflict)
	}
	finalRequestID := bookMergeRequestID(requestID)
	finalJob, findErr := repository.FindMergeJob(ctx, owner, batchID, finalRequestID)
	if errors.Is(findErr, ErrNotFound) {
		if s.Adapter == nil {
			return BookMergeStatus{}, ErrUnavailable
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
		finalJob, err = s.submitStructuredMergeJob(ctx, repository, owner, MergeJob{
			Owner:                owner,
			BatchID:              batchID,
			RootRequestID:        requestID,
			RequestID:            finalRequestID,
			BookID:               bookID,
			Stage:                MergeStageBook,
			TimingMode:           recoveredOptions.TimingMode,
			Speed:                recoveredOptions.Speed,
			TTSSpeed:             recoveredOptions.TTSSpeed,
			AudioDurationSeconds: recoveredOptions.AudioDurationSeconds,
			Status:               MergeQueued,
			Sources:              finalSources,
			CreatedAt:            now,
			UpdatedAt:            now,
		}, recoveredOptions)
		if err != nil {
			return BookMergeStatus{}, err
		}
	} else if findErr != nil {
		return BookMergeStatus{}, findErr
	} else {
		if finalJob.Stage != MergeStageBook || finalJob.BookID != bookID || finalJob.RootRequestID != requestID {
			return BookMergeStatus{}, fmt.Errorf("%w: Book merge identity mismatch", ErrConflict)
		}
		finalJob, err = s.pollStructuredMergeJob(ctx, repository, owner, batchID, finalJob)
		if err != nil {
			return BookMergeStatus{}, err
		}
	}
	status.FinalJob = &finalJob
	status.Status = aggregateBookMergeState(finalJob)
	return status, nil
}
