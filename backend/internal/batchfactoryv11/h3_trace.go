package batchfactoryv11

import (
	"context"
	"time"
)

type H3ProductionSubmission struct {
	JobID                    string          `json:"job_id"`
	TaskID                   string          `json:"task_id"`
	VideoID                  string          `json:"video_id"`
	Provider                 string          `json:"provider"`
	ProviderTaskID           string          `json:"provider_task_id,omitempty"`
	Status                   ProductionState `json:"status"`
	CompilationID            string          `json:"compilation_id"`
	CompilationSegmentKey    string          `json:"compilation_segment_key"`
	CompiledPrompt           string          `json:"compiled_prompt"`
	CompiledPromptHash       string          `json:"compiled_prompt_hash"`
	CompileTrace             *H3CompileTrace `json:"compile_trace,omitempty"`
	RequestedDurationSeconds float64         `json:"requested_duration_seconds,omitempty"`
	ActualDurationSeconds    float64         `json:"actual_duration_seconds,omitempty"`
	MediaURL                 string          `json:"media_url,omitempty"`
	ErrorMessage             string          `json:"error_message,omitempty"`
	SubmittedAt              time.Time       `json:"submitted_at"`
}

type H3RunTrace struct {
	Legacy             bool                        `json:"legacy"`
	Notice             string                      `json:"notice,omitempty"`
	DirectorRevisionID string                      `json:"director_revision_id,omitempty"`
	DirectorDocument   *H3DirectorDocument         `json:"director_document,omitempty"`
	Timeline           H3CanonicalTimelineRevision `json:"timeline,omitempty"`
	Compilation        H3VideoCompilationRevision  `json:"compilation,omitempty"`
	Production         []H3ProductionSubmission    `json:"production"`
}

func (s *H3KernelService) Trace(ctx context.Context, owner, batchID, bookID, compilationID string) (H3RunTrace, error) {
	if s == nil || s.Store == nil {
		return H3RunTrace{}, ErrUnavailable
	}
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil {
		return H3RunTrace{}, err
	}
	book, err := bookFromBatch(batch, bookID)
	if err != nil {
		return H3RunTrace{}, err
	}
	if book.DirectorRevision == nil || book.DirectorRevision.Output.H3Director == nil {
		return H3RunTrace{Legacy: true, Notice: "旧版导演数据，无完整 H3 Trace", Production: []H3ProductionSubmission{}}, nil
	}
	repository, ok := s.Store.(H3Repository)
	if !ok {
		return H3RunTrace{}, ErrUnavailable
	}
	var compilation H3VideoCompilationRevision
	if compilationID == "" {
		compilation, err = repository.LatestH3VideoCompilation(ctx, owner, batchID, bookID, book.DirectorRevision.ID)
	} else {
		compilation, err = repository.GetH3VideoCompilation(ctx, owner, compilationID)
	}
	if err != nil {
		return H3RunTrace{}, err
	}
	if compilation.BatchID != batchID || compilation.BookID != bookID || compilation.Compilation.DirectorRevisionID != book.DirectorRevision.ID {
		return H3RunTrace{}, ErrNotFound
	}
	timeline, err := repository.GetH3CanonicalTimeline(ctx, owner, compilation.Compilation.CanonicalTimelineID)
	if err != nil {
		return H3RunTrace{}, err
	}
	trace := H3RunTrace{
		Legacy:             false,
		DirectorRevisionID: book.DirectorRevision.ID,
		DirectorDocument:   book.DirectorRevision.Output.H3Director,
		Timeline:           timeline,
		Compilation:        compilation,
		Production:         []H3ProductionSubmission{},
	}
	production, ok := s.Store.(ProductionRepository)
	if !ok {
		return trace, nil
	}
	jobs, err := production.ListProductionJobs(ctx, owner, batchID)
	if err != nil {
		return H3RunTrace{}, err
	}
	for _, job := range jobs {
		if job.BookID != bookID {
			continue
		}
		for _, task := range job.Tasks {
			if task.CompilationID != compilation.ID {
				continue
			}
			trace.Production = append(trace.Production, H3ProductionSubmission{
				JobID: job.ID, TaskID: task.ID, VideoID: task.VideoID, Provider: task.Provider,
				ProviderTaskID: task.ProviderTaskID, Status: task.Status,
				CompilationID: task.CompilationID, CompilationSegmentKey: task.CompilationSegmentKey,
				CompiledPrompt: task.CompiledPrompt, CompiledPromptHash: task.FinalPromptHash,
				CompileTrace:             cloneH3CompileTrace(task.CompileTrace),
				RequestedDurationSeconds: task.RequestedDurationSeconds, ActualDurationSeconds: task.ActualDurationSeconds,
				MediaURL: task.MediaURL, ErrorMessage: task.ErrorMessage, SubmittedAt: task.CreatedAt,
			})
		}
	}
	return trace, nil
}
