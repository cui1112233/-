package mergeworker

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type SourceDownloader interface {
	Download(context.Context, []Source, string) ([]string, error)
}

type MediaMerger interface {
	Merge(context.Context, []string, string, float64) error
}

type DurationAwareMediaMerger interface {
	MediaMerger
	TotalDuration(context.Context, []string) (float64, error)
}

type Worker struct {
	Store      Store
	Queue      Queue
	Downloader SourceDownloader
	Merger     MediaMerger
	Output     ObjectStore
	WorkRoot   string
}

func (w *Worker) ProcessOne(ctx context.Context, wait time.Duration) error {
	if w == nil || w.Store == nil || w.Queue == nil || w.Downloader == nil || w.Merger == nil || w.Output == nil {
		return fmt.Errorf("merge worker is not configured")
	}
	id, err := w.Queue.Dequeue(ctx, wait)
	if err != nil {
		return err
	}
	job, err := w.Store.Get(ctx, id)
	if err != nil {
		return err
	}
	if job.Status == StateSucceeded || job.Status == StateFailed {
		return nil
	}
	if job.Status != StateQueued && job.Status != StateRunning {
		return w.fail(ctx, job, fmt.Errorf("invalid merge state"))
	}
	job.Status = StateRunning
	job.ErrorMessage = ""
	job.OutputURL = ""
	job, err = w.Store.Update(ctx, job)
	if err != nil {
		return err
	}

	root := strings.TrimSpace(w.WorkRoot)
	if root == "" {
		root = os.TempDir()
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return w.fail(ctx, job, err)
	}
	dir, err := os.MkdirTemp(root, "qiantie-merge-")
	if err != nil {
		return w.fail(ctx, job, err)
	}
	defer os.RemoveAll(dir)

	inputs, err := w.Downloader.Download(ctx, job.Sources, dir)
	if err != nil {
		return w.fail(ctx, job, err)
	}
	outputPath := filepath.Join(dir, "merged.mp4")
	sourceDuration := 0.0
	if normalizeTimingMode(job.TimingMode) == "audio" && job.Speed == 0 {
		durationMerger, ok := w.Merger.(DurationAwareMediaMerger)
		if !ok {
			return w.fail(ctx, job, fmt.Errorf("audio timing requires duration-aware merger"))
		}
		sourceDuration, err = durationMerger.TotalDuration(ctx, inputs)
		if err != nil {
			return w.fail(ctx, job, err)
		}
	}
	speed, err := ResolveMergeSpeed(job.TimingMode, job.Speed, sourceDuration, job.AudioDurationSeconds)
	if err != nil {
		return w.fail(ctx, job, err)
	}
	if err := w.Merger.Merge(ctx, inputs, outputPath, speed); err != nil {
		return w.fail(ctx, job, err)
	}
	info, err := os.Stat(outputPath)
	if err != nil || info.Size() <= 0 {
		if err == nil {
			err = fmt.Errorf("merged output is empty")
		}
		return w.fail(ctx, job, err)
	}
	outputURL, err := w.Output.PutMerged(ctx, job.ID, outputPath)
	if err != nil || strings.TrimSpace(outputURL) == "" {
		if err == nil {
			err = fmt.Errorf("output store returned empty URL")
		}
		return w.fail(ctx, job, err)
	}
	job.Status = StateSucceeded
	job.OutputURL = strings.TrimSpace(outputURL)
	job.ErrorMessage = ""
	_, err = w.Store.Update(ctx, job)
	return err
}

func (w *Worker) fail(ctx context.Context, job Job, cause error) error {
	job.Status = StateFailed
	job.OutputURL = ""
	job.ErrorMessage = "merge execution failed"
	if w != nil && w.Store != nil {
		_, _ = w.Store.Update(ctx, job)
	}
	if cause == nil {
		cause = errors.New("merge execution failed")
	}
	return fmt.Errorf("merge execution failed: %w", cause)
}

func (w *Worker) Run(ctx context.Context) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := w.ProcessOne(ctx, 5*time.Second)
		if err == nil || errors.Is(err, ErrQueueEmpty) {
			continue
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// Processing errors are already persisted on the job. Keep the worker
		// alive for the next task instead of turning one bad video into downtime.
	}
}
