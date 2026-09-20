package batchfactoryv11

import (
	"context"
	"fmt"
	"strings"
)

type BookStageAvailability struct {
	Stage     BookStage `json:"stage"`
	Available bool      `json:"available"`
	Reason    string    `json:"reason,omitempty"`
}

type BookStageSummary struct {
	BookID       string                  `json:"bookId"`
	Runs         []BookStageRun          `json:"runs"`
	Availability []BookStageAvailability `json:"availability"`
	LastFailed   *BookStageRun           `json:"lastFailed,omitempty"`
}

type BookStageService struct {
	Store      Store
	Director   *DirectorService
	Production *ProductionService
}

func (s *BookStageService) repository() (BookStageRunRepository, error) {
	if s == nil || s.Store == nil {
		return nil, ErrUnavailable
	}
	repository, ok := s.Store.(BookStageRunRepository)
	if !ok {
		return nil, ErrUnavailable
	}
	return repository, nil
}

func (s *BookStageService) availability(stage BookStage) BookStageAvailability {
	switch stage {
	case BookStageDirector:
		if s != nil && s.Director != nil && s.Director.Store != nil && s.Director.Provider != nil {
			return BookStageAvailability{Stage: stage, Available: true}
		}
		return BookStageAvailability{Stage: stage, Reason: "文本模型未配置"}
	case BookStageImage:
		// V11 currently persists uploaded/provider-returned images but has no image
		// provider adapter. Never claim a generated image that has not been produced.
		return BookStageAvailability{Stage: stage, Reason: "图片模型或图片生成服务未配置"}
	case BookStageVideo:
		if s != nil && s.Production != nil && s.Production.Enabled {
			return BookStageAvailability{Stage: stage, Available: true}
		}
		return BookStageAvailability{Stage: stage, Reason: "视频生成服务未启用"}
	default:
		return BookStageAvailability{Stage: stage, Reason: "未知阶段"}
	}
}

func (s *BookStageService) Summary(ctx context.Context, owner, batchID, bookID string) (BookStageSummary, error) {
	repository, err := s.repository()
	if err != nil {
		return BookStageSummary{}, err
	}
	if _, err := s.Store.GetBatch(ctx, owner, batchID); err != nil {
		return BookStageSummary{}, err
	}
	runs, err := repository.ListBookStageRuns(ctx, owner, batchID, bookID)
	if err != nil {
		return BookStageSummary{}, err
	}
	availability := []BookStageAvailability{s.availability(BookStageDirector), s.availability(BookStageImage), s.availability(BookStageVideo)}
	return BookStageSummary{BookID: bookID, Runs: runs, Availability: availability, LastFailed: LatestFailedBookStageRun(runs)}, nil
}

func (s *BookStageService) nextAttempt(runs []BookStageRun, stage BookStage) int {
	highest := 0
	for _, run := range runs {
		if run.Stage == stage && run.Attempt > highest {
			highest = run.Attempt
		}
	}
	return highest + 1
}

func (s *BookStageService) createRun(ctx context.Context, owner, batchID, bookID string, stage BookStage, requestID, inputRevision string) (BookStageRun, error) {
	repository, err := s.repository()
	if err != nil {
		return BookStageRun{}, err
	}
	runs, err := repository.ListBookStageRuns(ctx, owner, batchID, bookID)
	if err != nil {
		return BookStageRun{}, err
	}
	return repository.CreateBookStageRun(ctx, BookStageRun{Owner: owner, BatchID: batchID, BookID: bookID, Stage: stage, Status: ProductionRunning, Attempt: s.nextAttempt(runs, stage), RequestID: requestID, InputRevision: inputRevision})
}

func (s *BookStageService) finish(ctx context.Context, owner string, run BookStageRun, runErr error) error {
	repository, err := s.repository()
	if err != nil {
		return err
	}
	status := ProductionSucceeded
	text := ""
	if runErr != nil {
		status, text = ProductionFailed, productionError(runErr)
	}
	_, err = repository.UpdateBookStageRun(ctx, owner, run.ID, BookStageRun{Status: status, ErrorMessage: text})
	return err
}

// immediateVideoProviderFailure turns a provider-side rejection that was
// persisted on a production task into a failed book stage. A queued/running
// task remains a valid asynchronous submission.
func immediateVideoProviderFailure(job ProductionJob) error {
	for _, task := range job.Tasks {
		if task.Status != ProductionFailed && task.Status != ProductionCancelled {
			continue
		}
		message := strings.TrimSpace(task.ErrorMessage)
		if message == "" {
			message = "视频模型未返回可执行任务或成片地址"
		}
		return fmt.Errorf("%w: 视频模型提交失败（%s）：%s", ErrUnavailable, task.VideoID, message)
	}
	return nil
}

func (s *BookStageService) Run(ctx context.Context, owner, batchID, bookID string, stage BookStage, mode StageMode, requestID, videoID string) (BookStageSummary, error) {
	return s.run(ctx, owner, batchID, bookID, stage, mode, requestID, videoID, "")
}

func (s *BookStageService) run(ctx context.Context, owner, batchID, bookID string, stage BookStage, mode StageMode, requestID, videoID, frozenCompilationID string) (BookStageSummary, error) {
	if !validBookStage(stage) {
		return BookStageSummary{}, ErrInvalid
	}
	if mode != StageModeMissing && mode != StageModeForce {
		return BookStageSummary{}, ErrInvalid
	}
	if strings.TrimSpace(requestID) == "" {
		return BookStageSummary{}, fmt.Errorf("%w: request id is required", ErrInvalid)
	}
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil {
		return BookStageSummary{}, err
	}
	book, err := bookFromBatch(batch, bookID)
	if err != nil {
		return BookStageSummary{}, err
	}
	availability := s.availability(stage)
	inputRevision := ""
	if stage == BookStageVideo {
		inputRevision = strings.TrimSpace(videoID)
	}
	run, createErr := s.createRun(ctx, owner, batchID, bookID, stage, requestID, inputRevision)
	if createErr != nil {
		return BookStageSummary{}, createErr
	}
	if !availability.Available {
		err = fmt.Errorf("%w: %s", ErrUnavailable, availability.Reason)
		_ = s.finish(ctx, owner, run, err)
		summary, _ := s.Summary(ctx, owner, batchID, bookID)
		return summary, err
	}
	switch stage {
	case BookStageDirector:
		if mode == StageModeMissing && book.DirectorRevision != nil {
			err = fmt.Errorf("%w: 文案已存在；请使用重新生成文案", ErrConflict)
		} else {
			var revision DirectorRevision
			revision, err = s.Director.RunDirector(ctx, owner, batchID, bookID)
			if err == nil {
				run.InputRevision = revision.ID
			}
		}
	case BookStageVideo:
		if mode == StageModeMissing {
			var job ProductionJob
			job, err = s.Production.SubmitBookProductionWithOptions(ctx, owner, batchID, bookID, requestID, rawString(ResolveSettings(batch.SettingsState.Patch, book.SettingsState.Patch), "videoProvider", VideoProviderPersonalAPI), ProductionOptions{VideoID: videoID, CompilationID: frozenCompilationID})
			if err == nil {
				err = immediateVideoProviderFailure(job)
			}
		} else {
			var job ProductionJob
			job, err = s.Production.SubmitBookProductionWithOptions(ctx, owner, batchID, bookID, requestID, rawString(ResolveSettings(batch.SettingsState.Patch, book.SettingsState.Patch), "videoProvider", VideoProviderPersonalAPI), ProductionOptions{Force: true, VideoID: videoID, CompilationID: frozenCompilationID})
			if err == nil {
				err = immediateVideoProviderFailure(job)
			}
		}
	}
	if finishErr := s.finish(ctx, owner, run, err); finishErr != nil {
		return BookStageSummary{}, finishErr
	}
	summary, summaryErr := s.Summary(ctx, owner, batchID, bookID)
	if summaryErr != nil {
		return BookStageSummary{}, summaryErr
	}
	return summary, err
}

// RetryLastFailed reruns only the most recently failed stage recorded for this book.
func (s *BookStageService) RetryLastFailed(ctx context.Context, owner, batchID, bookID, requestID, videoID string) (BookStageSummary, error) {
	summary, err := s.Summary(ctx, owner, batchID, bookID)
	if err != nil {
		return BookStageSummary{}, err
	}
	if summary.LastFailed == nil {
		return BookStageSummary{}, fmt.Errorf("%w: 当前小说没有失败步骤", ErrConflict)
	}
	if strings.TrimSpace(videoID) == "" && summary.LastFailed.Stage == BookStageVideo {
		videoID = summary.LastFailed.InputRevision
	}
	frozenCompilationID := ""
	if summary.LastFailed.Stage == BookStageVideo {
		frozenCompilationID = s.latestFailedH3CompilationID(ctx, owner, batchID, bookID, videoID)
	}
	return s.run(ctx, owner, batchID, bookID, summary.LastFailed.Stage, StageModeForce, requestID, videoID, frozenCompilationID)
}

func (s *BookStageService) latestFailedH3CompilationID(ctx context.Context, owner, batchID, bookID, videoID string) string {
	repository, ok := s.Store.(ProductionRepository)
	if !ok {
		return ""
	}
	jobs, err := repository.ListProductionJobs(ctx, owner, batchID)
	if err != nil {
		return ""
	}
	latestID := ""
	var latestJob ProductionJob
	for _, job := range jobs {
		if job.BookID != bookID {
			continue
		}
		for _, task := range job.Tasks {
			if task.VideoID != videoID || task.Status != ProductionFailed || strings.TrimSpace(task.CompilationID) == "" {
				continue
			}
			if latestID == "" || job.CreatedAt.After(latestJob.CreatedAt) || (job.CreatedAt.Equal(latestJob.CreatedAt) && job.ID > latestJob.ID) {
				latestJob, latestID = job, task.CompilationID
			}
		}
	}
	return latestID
}
