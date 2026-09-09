package batchfactoryv11

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

type MergeState string

const (
	MergeQueued    MergeState = "queued"
	MergeRunning   MergeState = "running"
	MergeSucceeded MergeState = "succeeded"
	MergeFailed    MergeState = "failed"
)

type MergeMedia struct {
	ProductionJobID string `json:"productionJobId"`
	VideoID         string `json:"videoId"`
	MediaURL        string `json:"mediaUrl"`
	Order           int    `json:"order"`
}

type MergeOptions struct {
	TimingMode string  `json:"timingMode,omitempty"`
	Speed      float64 `json:"speed,omitempty"`
	TTSSpeed   float64 `json:"ttsSpeed,omitempty"`
}

type MergeJob struct {
	ID            string       `json:"id"`
	Owner         string       `json:"-"`
	BatchID       string       `json:"batchId"`
	RequestID     string       `json:"requestId"`
	ProviderTaskID string       `json:"providerTaskId,omitempty"`
	Status        MergeState   `json:"status"`
	Sources       []MergeMedia `json:"sources"`
	OutputURL     string       `json:"outputUrl,omitempty"`
	ErrorMessage  string       `json:"errorMessage,omitempty"`
	CreatedAt     time.Time    `json:"createdAt"`
	UpdatedAt     time.Time    `json:"updatedAt"`
}

type MergeAdapter interface {
	Submit(context.Context, string, []MergeMedia, MergeOptions) (MergeJob, error)
}

type MergePoller interface {
	Poll(context.Context, string, MergeJob) (MergeJob, error)
}

type MergeRepository interface {
	FindMergeJob(context.Context, string, string, string) (MergeJob, error)
	CreateMergeJob(context.Context, MergeJob) (MergeJob, error)
	UpdateMergeJob(context.Context, string, string, MergeJob) (MergeJob, error)
	ListMergeJobs(context.Context, string, string) ([]MergeJob, error)
}

type MergeService struct {
	Store   Store
	Adapter MergeAdapter
	Poller  MergePoller
	Enabled bool
}

func normalizeMergeOptions(options MergeOptions) (MergeOptions, error) {
	options.TimingMode = strings.TrimSpace(options.TimingMode)
	if options.TimingMode == "" {
		options.TimingMode = "speed"
	}
	if options.TimingMode != "speed" && options.TimingMode != "audio" {
		return MergeOptions{}, fmt.Errorf("%w: unsupported merge timing mode", ErrInvalid)
	}
	if options.Speed == 0 {
		options.Speed = 1
	}
	if options.Speed < 0.5 || options.Speed > 4 {
		return MergeOptions{}, fmt.Errorf("%w: merge speed must be between 0.5 and 4", ErrInvalid)
	}
	if options.TTSSpeed == 0 {
		options.TTSSpeed = 1.7
	}
	if options.TTSSpeed < 0.5 || options.TTSSpeed > 4 {
		return MergeOptions{}, fmt.Errorf("%w: tts speed must be between 0.5 and 4", ErrInvalid)
	}
	return options, nil
}

func (s *MergeService) repository() (MergeRepository, error) {
	if s == nil || s.Store == nil {
		return nil, ErrUnavailable
	}
	repository, ok := s.Store.(MergeRepository)
	if !ok {
		return nil, ErrUnavailable
	}
	return repository, nil
}

func normalizeMergeState(value MergeState) MergeState {
	switch value {
	case MergeQueued, MergeRunning, MergeSucceeded, MergeFailed:
		return value
	default:
		return MergeRunning
	}
}

func (s *MergeService) SubmitBatchMerge(ctx context.Context, owner, batchID, requestID string, options MergeOptions) (MergeJob, error) {
	if s == nil || !s.Enabled {
		return MergeJob{}, fmt.Errorf("%w: merge is not enabled", ErrUnavailable)
	}
	if s.Adapter == nil {
		return MergeJob{}, ErrUnavailable
	}
	if strings.TrimSpace(requestID) == "" {
		return MergeJob{}, fmt.Errorf("%w: request id is required", ErrInvalid)
	}
	options, err := normalizeMergeOptions(options)
	if err != nil {
		return MergeJob{}, err
	}
	repository, err := s.repository()
	if err != nil {
		return MergeJob{}, err
	}
	if existing, findErr := repository.FindMergeJob(ctx, owner, batchID, requestID); findErr == nil {
		return existing, nil
	} else if !errors.Is(findErr, ErrNotFound) {
		return MergeJob{}, findErr
	}
	if _, err := s.Store.GetBatch(ctx, owner, batchID); err != nil {
		return MergeJob{}, err
	}
	productionRepository, ok := s.Store.(ProductionRepository)
	if !ok {
		return MergeJob{}, ErrUnavailable
	}
	productionJobs, err := productionRepository.ListProductionJobs(ctx, owner, batchID)
	if err != nil {
		return MergeJob{}, err
	}
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil {
		return MergeJob{}, err
	}
	sources := []MergeMedia{}
	if len(batch.Books) == 0 {
		return MergeJob{}, fmt.Errorf("%w: batch has no books ready for merge", ErrConflict)
	}
	for _, book := range batch.Books {
		// A batch merge is all-or-nothing. Do not silently omit a book and
		// produce a partial final movie that the UI reports as complete.
		if book.DirectorRevision == nil || len(book.Videos) == 0 {
			return MergeJob{}, fmt.Errorf("%w: book %s is not ready for merge", ErrConflict, book.ID)
		}
		tasks := latestProductionTasks(productionJobs, book.ID, book.DirectorRevision.ID)
		for _, video := range book.Videos {
			selection, found := tasks[video.ID]
			if !found || selection.Task.Status != ProductionSucceeded || strings.TrimSpace(selection.Task.MediaURL) == "" {
				return MergeJob{}, fmt.Errorf("%w: book %s has VIDEOs without completed media", ErrConflict, book.ID)
			}
			sources = append(sources, MergeMedia{
				ProductionJobID: selection.JobID,
				VideoID:         video.ID,
				MediaURL:        selection.Task.MediaURL,
				Order:           len(sources),
			})
		}
	}
	if len(sources) == 0 {
		return MergeJob{}, fmt.Errorf("%w: no completed production media", ErrConflict)
	}
	now := time.Now().UTC()
	job := MergeJob{Owner: owner, BatchID: batchID, RequestID: requestID, Status: MergeQueued, Sources: sources, CreatedAt: now, UpdatedAt: now}
	job, err = repository.CreateMergeJob(ctx, job)
	if err != nil {
		return MergeJob{}, err
	}
	result, submitErr := s.Adapter.Submit(ctx, batchID, append([]MergeMedia(nil), job.Sources...), options)
	updated := job
	updated.Status = normalizeMergeState(result.Status)
	updated.ProviderTaskID = strings.TrimSpace(result.ProviderTaskID)
	updated.OutputURL = strings.TrimSpace(result.OutputURL)
	updated.ErrorMessage = strings.TrimSpace(result.ErrorMessage)
	if submitErr != nil {
		updated.Status = MergeFailed
		updated.ErrorMessage = productionError(submitErr)
	}
	updated, err = repository.UpdateMergeJob(ctx, owner, job.ID, updated)
	if err != nil {
		return MergeJob{}, err
	}
	return updated, nil
}

// GetBatchStatus returns merge jobs owned by the caller. It deliberately
// checks the parent batch first so a missing or cross-owner batch never leaks
// merge history.
func (s *MergeService) GetBatchStatus(ctx context.Context, owner, batchID string) ([]MergeJob, error) {
	if s == nil || !s.Enabled {
		return nil, fmt.Errorf("%w: merge is not enabled", ErrUnavailable)
	}
	repository, err := s.repository()
	if err != nil {
		return nil, err
	}
	if _, err := s.Store.GetBatch(ctx, owner, batchID); err != nil {
		return nil, err
	}
	jobs, err := repository.ListMergeJobs(ctx, owner, batchID)
	if err != nil {
		return nil, err
	}
	if s.Poller == nil {
		return jobs, nil
	}
	for index, job := range jobs {
		if job.ProviderTaskID == "" || (job.Status != MergeQueued && job.Status != MergeRunning) {
			continue
		}
		result, pollErr := s.Poller.Poll(ctx, batchID, job)
		if pollErr != nil {
			continue
		}
		updated := job
		updated.Status = normalizeMergeState(result.Status)
		updated.ProviderTaskID = strings.TrimSpace(result.ProviderTaskID)
		updated.OutputURL = strings.TrimSpace(result.OutputURL)
		updated.ErrorMessage = strings.TrimSpace(result.ErrorMessage)
		if _, updateErr := repository.UpdateMergeJob(ctx, owner, job.ID, updated); updateErr != nil {
			return nil, updateErr
		}
		jobs[index] = updated
	}
	return jobs, nil
}

type productionTaskSelection struct {
	JobID string
	Task  ProductionTask
}

func latestProductionTasks(jobs []ProductionJob, bookID, directorRevisionID string) map[string]productionTaskSelection {
	out := map[string]productionTaskSelection{}
	for _, job := range jobs {
		if job.BookID != bookID || job.DirectorRevisionID != directorRevisionID {
			continue
		}
		for _, task := range job.Tasks {
			out[task.VideoID] = productionTaskSelection{JobID: job.ID, Task: task}
		}
	}
	return out
}
