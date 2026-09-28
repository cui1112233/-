package batchfactoryv11

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/localartifact"
	"qiantie/backend/internal/mergeworker"
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
	artifactRoot := t.TempDir()
	artifacts := localartifact.NewStore(artifactRoot, 1<<20)
	adapter := NewLocalMergeAdapter(artifacts)
	if adapter.WorkRoot != artifactRoot {
		t.Fatalf("work root=%q want artifact root=%q", adapter.WorkRoot, artifactRoot)
	}
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

type localMergeOutputFunc func(context.Context, string, string) (string, error)

func (fn localMergeOutputFunc) PutMerged(ctx context.Context, taskID, filePath string) (string, error) {
	return fn(ctx, taskID, filePath)
}

var _ mergeworker.ObjectStore = localMergeOutputFunc(nil)

func TestLocalMergeAdapterStoresCompletedOutputInTOS(t *testing.T) {
	artifactDir := t.TempDir()
	artifacts := localartifact.NewStore(artifactDir, 1<<20)
	adapter := NewLocalMergeAdapter(artifacts)
	adapter.Output = localMergeOutputFunc(func(_ context.Context, taskID, filePath string) (string, error) {
		if taskID == "" {
			t.Fatal("task id is required")
		}
		if _, err := os.Stat(filePath); err != nil {
			t.Fatalf("merged output must exist before TOS upload: %v", err)
		}
		return "https://media.example/batch-merged/" + taskID + ".mp4", nil
	})
	adapter.Downloader = localMergeDownloadFunc(func(_ context.Context, _ []MergeMedia, dir string, _ func(int, int)) ([]string, error) {
		input := filepath.Join(dir, "input.mp4")
		return []string{input}, os.WriteFile(input, []byte("input"), 0o600)
	})
	adapter.Merger = localMergeRunFunc(func(_ context.Context, _ []string, output string, _ float64) error {
		return os.WriteFile(output, []byte("0000ftypisom-local-merged-video"), 0o600)
	})

	queued, err := adapter.Submit(context.Background(), "batch-1", []MergeMedia{{ProductionJobID: "job-1", VideoID: "video-1", MediaURL: "https://media.example/one.mp4", Order: 0}}, MergeOptions{Speed: 1})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		result, pollErr := adapter.Poll(context.Background(), "batch-1", queued)
		if pollErr != nil {
			t.Fatalf("poll: %v", pollErr)
		}
		if result.Status == MergeSucceeded {
			if got, want := result.OutputURL, "https://media.example/batch-merged/"+queued.ProviderTaskID+".mp4"; got != want {
				t.Fatalf("output=%q want=%q", got, want)
			}
			entries, readErr := os.ReadDir(artifactDir)
			if readErr != nil {
				t.Fatalf("read artifact dir: %v", readErr)
			}
			if len(entries) != 0 {
				t.Fatalf("TOS merge must not persist a local finished artifact: %v", entries)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("merge did not finish: %+v", result)
		}
		time.Sleep(5 * time.Millisecond)
	}
}
