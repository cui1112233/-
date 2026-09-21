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
	// URL is an internal compatibility alias for older V11 consumers. It is
	// deliberately excluded from the provider JSON contract.
	URL                      string  `json:"-"`
	Order                    int     `json:"order"`
	TargetDurationSeconds    float64 `json:"targetDurationSeconds,omitempty"`
	RequestedDurationSeconds float64 `json:"requestedDurationSeconds,omitempty"`
	ActualDurationSeconds    float64 `json:"actualDurationSeconds,omitempty"`
}

type MergeOptions struct {
	TimingMode           string  `json:"timingMode,omitempty"`
	Speed                float64 `json:"speed,omitempty"`
	TTSSpeed             float64 `json:"ttsSpeed,omitempty"`
	AudioDurationSeconds float64 `json:"audioDurationSeconds,omitempty"`
	AspectRatio          string  `json:"-"`
}

type MergeJob struct {
	ID              string       `json:"id"`
	Owner           string       `json:"-"`
	BatchID         string       `json:"batchId"`
	BookID          string       `json:"bookId,omitempty"`
	RequestID       string       `json:"requestId"`
	TimingMode      string       `json:"timingMode,omitempty"`
	Speed           float64      `json:"speed,omitempty"`
	ProviderTaskID  string       `json:"providerTaskId,omitempty"`
	Status          MergeState   `json:"status"`
	ProgressPhase   string       `json:"progressPhase,omitempty"`
	ProgressCurrent int          `json:"progressCurrent,omitempty"`
	ProgressTotal   int          `json:"progressTotal,omitempty"`
	Sources         []MergeMedia `json:"sources"`
	OutputURL       string       `json:"outputUrl,omitempty"`
	ErrorMessage    string       `json:"errorMessage,omitempty"`
	CreatedAt       time.Time    `json:"createdAt"`
	UpdatedAt       time.Time    `json:"updatedAt"`
}

type MergeAdapter interface {
	Submit(context.Context, string, []MergeMedia, MergeOptions) (MergeJob, error)
}

type MergePoller interface {
	Poll(context.Context, string, MergeJob) (MergeJob, error)
}

// VideoDurationProbe reads the completed media artifact. Providers may return
// a usable URL without a duration, but audio-following merge must use the
// artifact's measured duration rather than the requested duration.
type VideoDurationProbe interface {
	DurationSeconds(context.Context, string) (float64, error)
}

type MergeRepository interface {
	FindMergeJob(context.Context, string, string, string) (MergeJob, error)
	CreateMergeJob(context.Context, MergeJob) (MergeJob, error)
	UpdateMergeJob(context.Context, string, string, MergeJob) (MergeJob, error)
	ListMergeJobs(context.Context, string, string) ([]MergeJob, error)
}

type MergeService struct {
	Store         Store
	Adapter       MergeAdapter
	Poller        MergePoller
	DurationProbe VideoDurationProbe
	Enabled       bool
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
	if options.TimingMode == "audio" {
		if options.AudioDurationSeconds <= 0 {
			return MergeOptions{}, fmt.Errorf("%w: actual audio duration is required when following audio", ErrInvalid)
		}
		// Follow-audio speed is computed from recorded output duration below.
		// TTSSpeed is retained only as a compatibility input and must not be
		// multiplied into this value.
		options.TTSSpeed = 0
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
	return s.submitMerge(ctx, owner, batchID, "", requestID, options)
}

// SubmitBookMerge produces one final video for exactly one novel. It shares the
// same source-selection contract as batch merge but never mixes another book's
// storyboard media into this book's deliverable.
func (s *MergeService) SubmitBookMerge(ctx context.Context, owner, batchID, bookID, requestID string, options MergeOptions) (MergeJob, error) {
	if strings.TrimSpace(bookID) == "" {
		return MergeJob{}, fmt.Errorf("%w: book id is required", ErrInvalid)
	}
	return s.submitMerge(ctx, owner, batchID, strings.TrimSpace(bookID), requestID, options)
}

func (s *MergeService) submitMerge(ctx context.Context, owner, batchID, onlyBookID, requestID string, options MergeOptions) (MergeJob, error) {
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
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil {
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
	books := batch.Books
	if onlyBookID != "" {
		books = nil
		for _, book := range batch.Books {
			if book.ID == onlyBookID {
				books = append(books, book)
				break
			}
		}
	}
	if len(books) == 0 {
		return MergeJob{}, fmt.Errorf("%w: book is not ready for merge", ErrConflict)
	}
	sources := []MergeMedia{}
	for _, book := range books {
		if book.DirectorRevision == nil || len(book.Videos) == 0 {
			return MergeJob{}, fmt.Errorf("%w: book %s is not ready for merge", ErrConflict, book.ID)
		}
		tasks := productionTaskSelections(productionJobs, book.ID, book.DirectorRevision.ID)
		mediaVideos := book.Videos
		// Fixed opening keeps all Director cards for review, but merges VIDEO01 only.
		if snapshot, snapshotErr := snapshotForBook(batch, book); snapshotErr != nil {
			return MergeJob{}, snapshotErr
		} else {
			if options.AspectRatio == "" {
				options.AspectRatio = snapshot.AspectRatio
			} else if options.AspectRatio != snapshot.AspectRatio {
				return MergeJob{}, fmt.Errorf("%w: batch merge cannot combine books with different aspect ratios", ErrConflict)
			}
			if snapshot.FixedSingleVideo && len(mediaVideos) > 1 {
				mediaVideos = mediaVideos[:1]
			}
		}
		for _, video := range mediaVideos {
			selection, found := selectedProductionTask(video, tasks[video.ID])
			if !found || selection.Task.Status != ProductionSucceeded || strings.TrimSpace(selection.Task.MediaURL) == "" {
				return MergeJob{}, fmt.Errorf("%w: book %s has VIDEOs without completed media", ErrConflict, book.ID)
			}
			mediaURL := strings.TrimSpace(selection.Task.MediaURL)
			if options.TimingMode == "audio" && selection.Task.ActualDurationSeconds <= 0 {
				if s.DurationProbe == nil {
					return MergeJob{}, fmt.Errorf("%w: book %s VIDEO %s has no actual duration yet", ErrConflict, book.ID, video.ID)
				}
				actualDuration, probeErr := s.DurationProbe.DurationSeconds(ctx, mediaURL)
				if probeErr != nil || actualDuration <= 0 {
					if probeErr == nil {
						probeErr = errors.New("duration probe returned zero")
					}
					return MergeJob{}, fmt.Errorf("%w: book %s VIDEO %s media duration probe failed: %v", ErrConflict, book.ID, video.ID, probeErr)
				}
				selection.Task.ActualDurationSeconds = actualDuration
				if _, updateErr := productionRepository.UpdateProductionTask(ctx, owner, selection.JobID, selection.Task.ID, selection.Task); updateErr != nil {
					return MergeJob{}, updateErr
				}
			}
			sources = append(sources, MergeMedia{ProductionJobID: selection.JobID, VideoID: video.ID, MediaURL: mediaURL, URL: mediaURL, Order: len(sources), TargetDurationSeconds: selection.Task.TargetDurationSeconds, RequestedDurationSeconds: selection.Task.RequestedDurationSeconds, ActualDurationSeconds: selection.Task.ActualDurationSeconds})
		}
	}
	if options.TimingMode == "audio" {
		actualTotal := 0.0
		for _, source := range sources {
			actualTotal += source.ActualDurationSeconds
		}
		if actualTotal <= 0 {
			return MergeJob{}, fmt.Errorf("%w: actual VIDEO duration is required when following audio", ErrConflict)
		}
		options.Speed = actualTotal / options.AudioDurationSeconds
		if options.Speed < 0.5 || options.Speed > 4 {
			return MergeJob{}, fmt.Errorf("%w: follow-audio speed %.3f is outside 0.5-4", ErrInvalid, options.Speed)
		}
	}
	providerSources := append([]MergeMedia(nil), sources...)
	now := time.Now().UTC()
	job := MergeJob{Owner: owner, BatchID: batchID, BookID: onlyBookID, RequestID: requestID, TimingMode: options.TimingMode, Speed: options.Speed, Status: MergeQueued, ProgressPhase: "queued", ProgressTotal: len(sources), Sources: sources, CreatedAt: now, UpdatedAt: now}
	job, err = repository.CreateMergeJob(ctx, job)
	if err != nil {
		return MergeJob{}, err
	}
	result, submitErr := s.Adapter.Submit(ctx, batchID, providerSources, options)
	updated := job
	applyMergeResult(&updated, result)
	if submitErr != nil {
		updated.Status, updated.ProgressPhase, updated.ErrorMessage = MergeFailed, "failed", productionError(submitErr)
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
			updated := job
			updated.Status = MergeFailed
			updated.ProgressPhase = "failed"
			updated.ErrorMessage = productionError(pollErr)
			updated.OutputURL = ""
			if _, updateErr := repository.UpdateMergeJob(ctx, owner, job.ID, updated); updateErr != nil {
				return nil, updateErr
			}
			jobs[index] = updated
			continue
		}
		updated := job
		applyMergeResult(&updated, result)
		if _, updateErr := repository.UpdateMergeJob(ctx, owner, job.ID, updated); updateErr != nil {
			return nil, updateErr
		}
		jobs[index] = updated
	}
	return jobs, nil
}

func applyMergeResult(target *MergeJob, result MergeJob) {
	if target == nil {
		return
	}
	target.Status = normalizeMergeState(result.Status)
	target.ProviderTaskID = strings.TrimSpace(result.ProviderTaskID)
	target.OutputURL = strings.TrimSpace(result.OutputURL)
	target.ErrorMessage = strings.TrimSpace(result.ErrorMessage)
	if strings.TrimSpace(result.ProgressPhase) != "" {
		target.ProgressPhase = strings.TrimSpace(result.ProgressPhase)
	}
	if result.ProgressTotal > 0 {
		target.ProgressTotal = result.ProgressTotal
	}
	if result.ProgressCurrent > 0 || result.ProgressTotal > 0 {
		target.ProgressCurrent = result.ProgressCurrent
	}
	switch target.Status {
	case MergeSucceeded:
		target.ProgressPhase = "completed"
		if target.ProgressTotal > 0 {
			target.ProgressCurrent = target.ProgressTotal
		}
	case MergeFailed:
		target.ProgressPhase = "failed"
	case MergeQueued:
		if target.ProgressPhase == "" {
			target.ProgressPhase = "queued"
		}
	case MergeRunning:
		if target.ProgressPhase == "" || target.ProgressPhase == "queued" {
			target.ProgressPhase = "running"
		}
	}
}

type productionTaskSelection struct {
	JobID string
	Task  ProductionTask
}

func productionTaskSelections(jobs []ProductionJob, bookID, directorRevisionID string) map[string][]productionTaskSelection {
	out := map[string][]productionTaskSelection{}
	for _, job := range jobs {
		if job.BookID != bookID || job.DirectorRevisionID != directorRevisionID {
			continue
		}
		for _, task := range job.Tasks {
			out[task.VideoID] = append(out[task.VideoID], productionTaskSelection{JobID: job.ID, Task: task})
		}
	}
	return out
}

// selectedProductionTask resolves the user-confirmed main media version. A
// saved primaryMediaTaskId wins; without an explicit choice, the latest
// successful task is the initial main version. Failed/running tasks are never
// eligible for merge, even when an old preference points at one.
func selectedProductionTask(video Video, candidates []productionTaskSelection) (productionTaskSelection, bool) {
	primaryID := rawString(video.SettingsState.Patch, "primaryMediaTaskId", "")
	if primaryID != "" {
		for _, candidate := range candidates {
			if candidate.Task.ID == primaryID && candidate.Task.Status == ProductionSucceeded && strings.TrimSpace(candidate.Task.MediaURL) != "" {
				return candidate, true
			}
		}
	}
	for index := len(candidates) - 1; index >= 0; index-- {
		candidate := candidates[index]
		if candidate.Task.Status == ProductionSucceeded && strings.TrimSpace(candidate.Task.MediaURL) != "" {
			return candidate, true
		}
	}
	return productionTaskSelection{}, false
}
