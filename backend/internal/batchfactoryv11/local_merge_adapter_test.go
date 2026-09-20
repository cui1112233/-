package batchfactoryv11

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/localartifact"
)

type localMergeDownloadFunc func(context.Context, []MergeMedia, string, func(int, int)) ([]string, error)

func (fn localMergeDownloadFunc) Download(ctx context.Context, sources []MergeMedia, dir string, onProgress func(int, int)) ([]string, error) {
	return fn(ctx, sources, dir, onProgress)
}

type localMergeRunFunc func(context.Context, []string, string, float64) error

func (fn localMergeRunFunc) Merge(ctx context.Context, inputs []string, output string, speed float64) error {
	return fn(ctx, inputs, output, speed)
}

func TestLocalMergeAdapterCreatesProtectedArtifactForCompletedMerge(t *testing.T) {
	artifacts := localartifact.NewStore(t.TempDir(), 1<<20)
	adapter := NewLocalMergeAdapter(artifacts)
	adapter.Downloader = localMergeDownloadFunc(func(_ context.Context, _ []MergeMedia, dir string, onProgress func(int, int)) ([]string, error) {
		input := filepath.Join(dir, "input.mp4")
		err := os.WriteFile(input, []byte("input"), 0o600)
		if err == nil && onProgress != nil {
			onProgress(1, 1)
		}
		return []string{input}, err
	})
	adapter.Merger = localMergeRunFunc(func(_ context.Context, _ []string, output string, _ float64) error {
		return os.WriteFile(output, []byte("0000ftypisom-local-merged-video"), 0o600)
	})

	queued, err := adapter.Submit(context.Background(), "batch-1", []MergeMedia{{ProductionJobID: "job-1", VideoID: "video-1", MediaURL: "https://media.example/one.mp4", Order: 0}}, MergeOptions{Speed: 1})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if queued.Status != MergeQueued || queued.ProviderTaskID == "" || queued.ProgressPhase != "queued" || queued.ProgressTotal != 1 {
		t.Fatalf("queued=%+v", queued)
	}

	deadline := time.Now().Add(time.Second)
	for {
		result, pollErr := adapter.Poll(context.Background(), "batch-1", queued)
		if pollErr != nil {
			t.Fatalf("poll: %v", pollErr)
		}
		if result.Status == MergeSucceeded {
			if result.ProgressPhase != "completed" || result.ProgressCurrent != 1 || result.ProgressTotal != 1 {
				t.Fatalf("completed progress=%+v", result)
			}
			if !strings.HasPrefix(result.OutputURL, "/api/batch-factory/v11/batches/batch-1/merge-media/") {
				t.Fatalf("output=%q", result.OutputURL)
			}
			artifactID := filepath.Base(result.OutputURL)
			file, openErr := artifacts.Open(artifactID + ".mp4")
			if openErr != nil {
				t.Fatalf("open merged artifact: %v", openErr)
			}
			_ = file.Close()
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("merge did not finish: %+v", result)
		}
		time.Sleep(5 * time.Millisecond)
	}
}
