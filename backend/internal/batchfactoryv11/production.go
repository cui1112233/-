package batchfactoryv11

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

type ProductionState string

const (
	ProductionQueued    ProductionState = "queued"
	ProductionRunning   ProductionState = "running"
	ProductionSucceeded ProductionState = "succeeded"
	ProductionFailed    ProductionState = "failed"
)

type FrozenVideoModel struct {
	ID          string `json:"id"`
	MaxDuration int    `json:"maxDuration"`
}

type ProviderTaskRef struct {
	ProviderTaskID string          `json:"providerTaskId,omitempty"`
	State          ProductionState `json:"state"`
	MediaURL       string          `json:"mediaUrl,omitempty"`
}

type ProductionTask struct {
	ID              string          `json:"id"`
	VideoID         string          `json:"videoId"`
	Provider        string          `json:"provider,omitempty"`
	Status          ProductionState `json:"status"`
	Attempt         int             `json:"attempt"`
	FinalPromptHash string          `json:"finalPromptHash"`
	CompiledPrompt  string          `json:"-"`
	ProviderTaskID  string          `json:"providerTaskId,omitempty"`
	MediaURL        string          `json:"mediaUrl,omitempty"`
	ErrorMessage    string          `json:"errorMessage,omitempty"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

type ProductionJob struct {
	ID                 string          `json:"id"`
	Owner              string          `json:"-"`
	BatchID            string          `json:"batchId"`
	BookID             string          `json:"bookId"`
	RequestID          string          `json:"requestId"`
	DirectorRevisionID string          `json:"directorRevisionId"`
	Status             ProductionState `json:"status"`
	Tasks              []ProductionTask `json:"tasks"`
	CreatedAt          time.Time       `json:"createdAt"`
	UpdatedAt          time.Time       `json:"updatedAt"`
}

type BatchStatus struct {
	BatchID string          `json:"batchId"`
	Jobs    []ProductionJob `json:"jobs"`
}

type PromptResolver interface {
	Compile(context.Context, string, string, string, string) (FinalPrompt, error)
}

type ProductionAdapter interface {
	Submit(context.Context, FrozenVideoModel, FinalPrompt) (ProviderTaskRef, error)
}

// ProductionRepository is separate from the general Store so that previous V11
// slices do not accidentally gain mutable production authority.
type ProductionRepository interface {
	FindProductionJob(context.Context, string, string, string, string) (ProductionJob, error)
	CreateProductionJob(context.Context, ProductionJob) (ProductionJob, error)
	UpdateProductionTask(context.Context, string, string, string, ProductionTask) (ProductionJob, error)
	ListProductionJobs(context.Context, string, string) ([]ProductionJob, error)
}

type ProductionService struct {
	Store            Store
	Compiler         PromptResolver
	Adapter          ProductionAdapter
	Poller           ProductionPoller
	ProviderRegistry VideoProviderRegistry
	LocalExecutor    *LocalExecutorVideoAdapter
	Enabled          bool
	Model            FrozenVideoModel
}

func (s *ProductionService) HasServerManagedVideoProvider(provider string) bool {
	if s == nil { return false }
	provider = normalizeVideoProvider(provider)
	return provider == VideoProviderAutoDLComfyUI && s.Adapter != nil && strings.TrimSpace(s.Model.ID) == VideoModelMiniMaxH3
}

func (s *ProductionService) resolveProvider(ctx context.Context, owner, provider string) (ProductionAdapter, FrozenVideoModel, error) {
	provider = normalizeVideoProvider(provider)
	if provider == VideoProviderDoubaoLocal {
		if s.LocalExecutor == nil || s.LocalExecutor.Client == nil {
			return nil, FrozenVideoModel{}, fmt.Errorf("%w: Doubao local executor is offline", ErrUnavailable)
		}
		if strings.TrimSpace(s.LocalExecutor.PublicBaseURL) == "" {
			return nil, FrozenVideoModel{}, fmt.Errorf("%w: local executor public artifact base URL is required for merge and publish", ErrUnavailable)
		}
		if err := s.LocalExecutor.EnsureAvailable(ctx, owner); err != nil {
			return nil, FrozenVideoModel{}, err
		}
		model := s.Model
		// The local executor has its own Doubao model identity; never inherit
		// the personal Yadi model from static server configuration.
		model.ID = "doubao-seedance"
		if model.MaxDuration <= 0 {
			model.MaxDuration = 15
		}
		return nil, model, nil
	}
	if provider == VideoProviderAutoDLComfyUI {
		if !s.HasServerManagedVideoProvider(provider) {
			return nil, FrozenVideoModel{}, fmt.Errorf("%w: MiniMax H3 server-managed provider is unavailable", ErrUnavailable)
		}
		model := s.Model
		model.ID = VideoModelMiniMaxH3
		if model.MaxDuration <= 0 { model.MaxDuration = 15 }
		return s.Adapter, model, nil
	}
	if provider != VideoProviderPersonalAPI {
		return nil, FrozenVideoModel{}, fmt.Errorf("%w: unsupported video provider", ErrInvalid)
	}
	if s.ProviderRegistry != nil {
		cfg, err := s.ProviderRegistry.Resolve(ctx, owner, provider)
		if err == nil {
		model := s.Model
		model.ID = cfg.Model
		if model.MaxDuration <= 0 {
			model.MaxDuration = 15
		}
		adapter := &YadiVideoAdapter{
			CreateURL: cfg.CreateURL, TasksURL: cfg.TasksURL, ResultURL: cfg.ResultURL,
			APIKey: cfg.APIKey, Model: cfg.Model,
		}
		if err := adapter.Validate(); err != nil {
			return nil, FrozenVideoModel{}, err
		}
		return adapter, model, nil
		}
		if s.Adapter == nil {
			return nil, FrozenVideoModel{}, err
		}
	}
	if s.Adapter == nil {
		return nil, FrozenVideoModel{}, fmt.Errorf("%w: personal video provider is unavailable", ErrUnavailable)
	}
	return s.Adapter, s.Model, nil
}

func (s *ProductionService) repository() (ProductionRepository, error) {
	repository, ok := s.Store.(ProductionRepository)
	if !ok { return nil, ErrUnavailable }
	return repository, nil
}

func productionError(err error) string {
	if err == nil { return "" }
	message := strings.TrimSpace(err.Error())
	if len(message) > 240 { return message[:240] }
	return message
}

func normalizeProductionState(value ProductionState) ProductionState {
	switch value {
	case ProductionQueued, ProductionRunning, ProductionSucceeded, ProductionFailed:
		return value
	default:
		return ProductionRunning
	}
}

func (s *ProductionService) SubmitBookProduction(ctx context.Context, owner, batchID, bookID, requestID string) (ProductionJob, error) {
	return s.SubmitBookProductionWithProvider(ctx, owner, batchID, bookID, requestID, VideoProviderPersonalAPI)
}

func (s *ProductionService) SubmitBookProductionWithProvider(ctx context.Context, owner, batchID, bookID, requestID, provider string) (ProductionJob, error) {
	// The gate deliberately comes before repository/compiler/provider work.
	if s == nil || !s.Enabled { return ProductionJob{}, fmt.Errorf("%w: production is not enabled", ErrUnavailable) }
	if s.Store == nil || s.Compiler == nil { return ProductionJob{}, ErrUnavailable }
	if strings.TrimSpace(requestID) == "" { return ProductionJob{}, fmt.Errorf("%w: request id is required", ErrInvalid) }
	provider = normalizeVideoProvider(provider)
	repository, err := s.repository()
	if err != nil { return ProductionJob{}, err }
	if existing, findErr := repository.FindProductionJob(ctx, owner, batchID, bookID, requestID); findErr == nil { return existing, nil } else if findErr != ErrNotFound { return ProductionJob{}, findErr }

	adapter, model, providerErr := s.resolveProvider(ctx, owner, provider)
	if providerErr != nil { return ProductionJob{}, providerErr }
	if provider != VideoProviderDoubaoLocal && adapter == nil { return ProductionJob{}, ErrUnavailable }
	if strings.TrimSpace(model.ID) == "" { return ProductionJob{}, fmt.Errorf("%w: frozen video model is required", ErrInvalid) }

	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil { return ProductionJob{}, err }
	book, err := bookFromBatch(batch, bookID)
	if err != nil { return ProductionJob{}, err }
	if book.DirectorRevision == nil || book.DirectorRevision.ID == "" { return ProductionJob{}, fmt.Errorf("%w: active Director revision is required", ErrConflict) }
	if len(book.Videos) == 0 { return ProductionJob{}, fmt.Errorf("%w: no active VIDEOs to produce", ErrConflict) }
	priorJobs, err := repository.ListProductionJobs(ctx, owner, batchID)
	if err != nil { return ProductionJob{}, err }
	blockedVideos := map[string]bool{}
	for _, prior := range priorJobs {
		if prior.BookID != bookID || prior.DirectorRevisionID != book.DirectorRevision.ID { continue }
		for _, task := range prior.Tasks {
			if task.Status == ProductionQueued || task.Status == ProductionRunning || task.Status == ProductionSucceeded {
				blockedVideos[task.VideoID] = true
			}
		}
	}
	pendingVideos := make([]Video, 0, len(book.Videos))
	for _, video := range book.Videos {
		if !blockedVideos[video.ID] { pendingVideos = append(pendingVideos, video) }
	}
	if len(pendingVideos) == 0 { return ProductionJob{}, fmt.Errorf("%w: no pending VIDEOs to produce", ErrConflict) }

	now := time.Now().UTC()
	job := ProductionJob{ID:"", Owner:owner, BatchID:batchID, BookID:bookID, RequestID:requestID, DirectorRevisionID:book.DirectorRevision.ID, Status:ProductionQueued, Tasks:[]ProductionTask{}, CreatedAt:now, UpdatedAt:now}
	prompts := make(map[string]FinalPrompt, len(pendingVideos))
	for _, video := range pendingVideos {
		prompt, compileErr := s.Compiler.Compile(ctx, owner, batchID, bookID, video.ID)
		if compileErr != nil { return ProductionJob{}, compileErr }
		selectedModel := rawString(prompt.EffectiveSettings.Values, "videoModelId", "")
		if selectedModel != "" && selectedModel != model.ID {
			return ProductionJob{}, fmt.Errorf("%w: selected video model %q is not available for provider %s", ErrConflict, selectedModel, provider)
		}
		prompts[video.ID] = prompt
		job.Tasks = append(job.Tasks, ProductionTask{VideoID:video.ID, Provider: provider, Status:ProductionQueued, Attempt:1, FinalPromptHash:prompt.SnapshotHash, CompiledPrompt:prompt.CompiledPrompt, CreatedAt:now, UpdatedAt:now})
	}
	job, err = repository.CreateProductionJob(ctx, job)
	if err != nil { return ProductionJob{}, err }

	for _, task := range job.Tasks {
		prompt, ok := prompts[task.VideoID]
		if !ok { return ProductionJob{}, fmt.Errorf("%w: persisted task prompt is missing", ErrConflict) }
		var ref ProviderTaskRef
		var submitErr error
		if provider == VideoProviderDoubaoLocal {
			ref, submitErr = s.LocalExecutor.Submit(ctx, owner, LocalVideoJobInput{
				SourceTaskID: "bf11:" + batchID + ":" + bookID + ":" + task.VideoID,
				BatchID: batchID, BookID: bookID, VideoID: task.VideoID,
				Model: model.ID, Prompt: prompt.CompiledPrompt,
				Duration: prompt.DurationSeconds,
				AspectRatio: rawString(prompt.EffectiveSettings.Values, "aspectRatio", "9:16"),
				Resolution: rawString(prompt.EffectiveSettings.Values, "resolution", "720p"),
			})
		} else {
			ref, submitErr = adapter.Submit(ctx, model, prompt)
		}
		task.UpdatedAt = time.Now().UTC()
		if submitErr != nil {
			task.Status, task.ErrorMessage = ProductionFailed, productionError(submitErr)
		} else {
			task.Status, task.ProviderTaskID, task.MediaURL = normalizeProductionState(ref.State), strings.TrimSpace(ref.ProviderTaskID), strings.TrimSpace(ref.MediaURL)
		}
		updated, updateErr := repository.UpdateProductionTask(ctx, owner, job.ID, task.ID, task)
		if updateErr != nil { return ProductionJob{}, updateErr }
		job = updated
	}
	return job, nil
}

// SubmitBatchProduction is the "generate pending" operation. It submits only
// current Director VIDEO identities that have no queued, running, or succeeded
// task, so a repeated batch-button click cannot duplicate successful work.
func (s *ProductionService) SubmitBatchProduction(ctx context.Context, owner, batchID, requestID string) (BatchStatus, error) {
	return s.SubmitBatchProductionWithProvider(ctx, owner, batchID, requestID, VideoProviderPersonalAPI)
}

func (s *ProductionService) SubmitBatchProductionWithProvider(ctx context.Context, owner, batchID, requestID, provider string) (BatchStatus, error) {
	if s == nil || !s.Enabled { return BatchStatus{}, fmt.Errorf("%w: production is not enabled", ErrUnavailable) }
	if strings.TrimSpace(requestID) == "" { return BatchStatus{}, fmt.Errorf("%w: request id is required", ErrInvalid) }
	if s.Store == nil { return BatchStatus{}, ErrUnavailable }
	provider = normalizeVideoProvider(provider)
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil { return BatchStatus{}, err }
	submitted := false
	for _, book := range batch.Books {
		if book.DirectorRevision == nil || len(book.Videos) == 0 { continue }
		_, submitErr := s.SubmitBookProductionWithProvider(ctx, owner, batchID, book.ID, requestID+":"+book.ID, provider)
		if errors.Is(submitErr, ErrConflict) { continue }
		if submitErr != nil { return BatchStatus{}, submitErr }
		submitted = true
	}
	status, err := s.GetBatchStatus(ctx, owner, batchID)
	if err != nil { return BatchStatus{}, err }
	if !submitted && len(status.Jobs) == 0 { return BatchStatus{}, fmt.Errorf("%w: no pending VIDEOs to produce", ErrConflict) }
	return status, nil
}

func (s *ProductionService) GetBatchStatus(ctx context.Context, owner, batchID string) (BatchStatus, error) {
	if s == nil || s.Store == nil { return BatchStatus{}, ErrUnavailable }
	repository, err := s.repository()
	if err != nil { return BatchStatus{}, err }
	if _, err := s.Store.GetBatch(ctx, owner, batchID); err != nil { return BatchStatus{}, err }
	if err := s.reconcileBatch(ctx, repository, owner, batchID); err != nil { return BatchStatus{}, err }
	jobs, err := repository.ListProductionJobs(ctx, owner, batchID)
	if err != nil { return BatchStatus{}, err }
	return BatchStatus{BatchID:batchID, Jobs:jobs}, nil
}

func (s *ProductionService) reconcileBatch(ctx context.Context, repository ProductionRepository, owner, batchID string) error {
	if s.Poller == nil && s.LocalExecutor == nil && s.ProviderRegistry == nil && s.Adapter == nil { return nil }
	jobs, err := repository.ListProductionJobs(ctx, owner, batchID)
	if err != nil { return err }
	for _, job := range jobs {
		for _, task := range job.Tasks {
			if task.ProviderTaskID == "" || (task.Status != ProductionQueued && task.Status != ProductionRunning) { continue }
			var ref ProviderTaskRef
			var pollErr error
			provider := normalizeVideoProvider(task.Provider)
			if provider == VideoProviderDoubaoLocal {
				if s.LocalExecutor == nil {
					pollErr = fmt.Errorf("%w: Doubao local executor is offline", ErrUnavailable)
				} else {
					ref, pollErr = s.LocalExecutor.Poll(ctx, owner, task.ProviderTaskID)
				}
			} else if provider == VideoProviderAutoDLComfyUI {
				adapter, model, resolveErr := s.resolveProvider(ctx, owner, provider)
				if resolveErr != nil {
					pollErr = resolveErr
				} else if poller, ok := adapter.(ProductionPoller); !ok {
					pollErr = fmt.Errorf("%w: provider does not support polling", ErrUnavailable)
				} else {
					ref, pollErr = poller.Poll(ctx, model, ProviderTaskRef{ProviderTaskID: task.ProviderTaskID, State: task.Status, MediaURL: task.MediaURL})
				}
			} else if s.ProviderRegistry != nil {
				adapter, model, resolveErr := s.resolveProvider(ctx, owner, provider)
				if resolveErr != nil && s.Poller != nil {
					ref, pollErr = s.Poller.Poll(ctx, s.Model, ProviderTaskRef{ProviderTaskID: task.ProviderTaskID, State: task.Status, MediaURL: task.MediaURL})
				} else if resolveErr != nil {
					pollErr = resolveErr
				} else if poller, ok := adapter.(ProductionPoller); !ok {
					pollErr = fmt.Errorf("%w: provider does not support polling", ErrUnavailable)
				} else {
					ref, pollErr = poller.Poll(ctx, model, ProviderTaskRef{ProviderTaskID: task.ProviderTaskID, State: task.Status, MediaURL: task.MediaURL})
				}
			} else if s.Poller != nil {
				ref, pollErr = s.Poller.Poll(ctx, s.Model, ProviderTaskRef{ProviderTaskID: task.ProviderTaskID, State: task.Status, MediaURL: task.MediaURL})
			} else {
				continue
			}
			updated := task
			if pollErr != nil {
				// A transport failure is retryable; persist a bounded diagnostic while
				// keeping the task running so a later status read can recover it.
				updated.ErrorMessage = productionError(pollErr)
			} else {
				updated.Status = normalizeProductionState(ref.State)
				updated.ProviderTaskID = strings.TrimSpace(ref.ProviderTaskID)
				updated.MediaURL = strings.TrimSpace(ref.MediaURL)
				if updated.Status == ProductionSucceeded { updated.ErrorMessage = "" }
			}
			if updated.Status == task.Status && updated.ProviderTaskID == task.ProviderTaskID && updated.MediaURL == task.MediaURL && updated.ErrorMessage == task.ErrorMessage { continue }
			if _, err := repository.UpdateProductionTask(ctx, owner, job.ID, task.ID, updated); err != nil { return err }
		}
	}
	return nil
}
