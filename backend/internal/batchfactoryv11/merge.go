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
	VideoID string `json:"videoId"`
	URL     string `json:"url"`
}

type MergeOptions struct {
	TimingMode string  `json:"timingMode,omitempty"`
	Speed      float64 `json:"speed,omitempty"`
	TTSSpeed   float64 `json:"ttsSpeed,omitempty"`
}

type MergeJob struct {
	ID        string      `json:"id"`
	Owner     string      `json:"-"`
	BatchID   string      `json:"batchId"`
	RequestID string      `json:"requestId"`
	Status    MergeState  `json:"status"`
	Sources   []MergeMedia `json:"sources"`
	OutputURL string      `json:"outputUrl,omitempty"`
	ErrorMessage string   `json:"errorMessage,omitempty"`
	CreatedAt time.Time   `json:"createdAt"`
	UpdatedAt time.Time   `json:"updatedAt"`
}

type MergeAdapter interface {
	Submit(context.Context, string, []MergeMedia, MergeOptions) (MergeJob, error)
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
	Enabled bool
}

func (s *MergeService) repository() (MergeRepository, error) {
	if s == nil || s.Store == nil { return nil, ErrUnavailable }
	repository, ok := s.Store.(MergeRepository)
	if !ok { return nil, ErrUnavailable }
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
	if s == nil || !s.Enabled { return MergeJob{}, fmt.Errorf("%w: merge is not enabled", ErrUnavailable) }
	if s.Adapter == nil { return MergeJob{}, ErrUnavailable }
	if strings.TrimSpace(requestID) == "" { return MergeJob{}, fmt.Errorf("%w: request id is required", ErrInvalid) }
	repository, err := s.repository()
	if err != nil { return MergeJob{}, err }
	if existing, findErr := repository.FindMergeJob(ctx, owner, batchID, requestID); findErr == nil { return existing, nil } else if !errors.Is(findErr, ErrNotFound) { return MergeJob{}, findErr }
	if _, err := s.Store.GetBatch(ctx, owner, batchID); err != nil { return MergeJob{}, err }
	productionRepository, ok := s.Store.(ProductionRepository)
	if !ok { return MergeJob{}, ErrUnavailable }
	productionJobs, err := productionRepository.ListProductionJobs(ctx, owner, batchID)
	if err != nil { return MergeJob{}, err }
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil { return MergeJob{}, err }
	sources := []MergeMedia{}
	for _, book := range batch.Books {
		if book.DirectorRevision == nil || len(book.Videos) == 0 { continue }
		tasks := latestProductionTasks(productionJobs, book.ID, book.DirectorRevision.ID)
		for _, video := range book.Videos {
			task, found := tasks[video.ID]
			if !found || task.Status != ProductionSucceeded || strings.TrimSpace(task.MediaURL) == "" {
				return MergeJob{}, fmt.Errorf("%w: book %s has VIDEOs without completed media", ErrConflict, book.ID)
			}
			sources = append(sources, MergeMedia{VideoID: video.ID, URL: task.MediaURL})
		}
	}
	if len(sources) == 0 { return MergeJob{}, fmt.Errorf("%w: no completed production media", ErrConflict) }
	now := time.Now().UTC()
	job := MergeJob{Owner: owner, BatchID: batchID, RequestID: requestID, Status: MergeQueued, Sources: sources, CreatedAt: now, UpdatedAt: now}
	job, err = repository.CreateMergeJob(ctx, job)
	if err != nil { return MergeJob{}, err }
	result, submitErr := s.Adapter.Submit(ctx, batchID, append([]MergeMedia(nil), job.Sources...), options)
	updated := job
	updated.Status = normalizeMergeState(result.Status)
	updated.OutputURL = strings.TrimSpace(result.OutputURL)
	updated.ErrorMessage = strings.TrimSpace(result.ErrorMessage)
	if submitErr != nil {
		updated.Status = MergeFailed
		updated.ErrorMessage = productionError(submitErr)
	}
	updated, err = repository.UpdateMergeJob(ctx, owner, job.ID, updated)
	if err != nil { return MergeJob{}, err }
	return updated, nil
}

func latestProductionTasks(jobs []ProductionJob, bookID, directorRevisionID string) map[string]ProductionTask {
	out := map[string]ProductionTask{}
	for _, job := range jobs {
		if job.BookID != bookID || job.DirectorRevisionID != directorRevisionID { continue }
		for _, task := range job.Tasks { out[task.VideoID] = task }
	}
	return out
}
