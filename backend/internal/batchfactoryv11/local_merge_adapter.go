package batchfactoryv11

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"qiantie/backend/internal/localartifact"
	"qiantie/backend/internal/mergeworker"
)

// LocalMergeAdapter is the preview-runtime merge executor. It performs the
// same safe download and ffmpeg work as the standalone merge worker, but keeps
// its finished MP4 in the local artifact store. It is intentionally activated
// only by the explicit local preview environment flag.
type LocalMergeAdapter struct {
	Artifacts  *localartifact.Store
	Downloader localMergeDownloader
	Merger     localMergeRunner
	// Output stores completed MP4s remotely. When configured, a successful
	// remote write replaces the otherwise local finished-artifact copy.
	Output   mergeworker.ObjectStore
	WorkRoot string

	mu    sync.RWMutex
	tasks map[string]MergeJob
}

// localMergeWorkspaceRecoveryAge exceeds the bounded merge context by a wide
// margin. A workspace older than this at adapter construction can only belong
// to an interrupted process; current workspaces are created after construction.
const localMergeWorkspaceRecoveryAge = 30 * time.Minute

type localMergeDownloader interface {
	Download(context.Context, []MergeMedia, string, func(int, int)) ([]string, error)
}

type localMergeRunner interface {
	Merge(context.Context, []string, string, float64) error
}

type aspectAwareLocalMergeRunner interface {
	MergeWithAspect(context.Context, []string, string, float64, string) error
}

type safeLocalMergeDownloader struct{ delegate *mergeworker.Downloader }

func (d safeLocalMergeDownloader) Download(ctx context.Context, sources []MergeMedia, dir string, onProgress func(int, int)) ([]string, error) {
	paths := make([]string, 0, len(sources))
	for index, source := range sources {
		// Downloader validates contiguous ordering. Isolating each source keeps
		// that invariant while allowing a durable progress update per VIDEO.
		sourceDir := filepath.Join(dir, fmt.Sprintf("%04d", index))
		downloaded, err := d.delegate.Download(ctx, []mergeworker.Source{{ProductionJobID: source.ProductionJobID, VideoID: source.VideoID, MediaURL: source.MediaURL, Order: 0}}, sourceDir)
		if err != nil {
			return nil, err
		}
		paths = append(paths, downloaded...)
		if onProgress != nil {
			onProgress(index+1, len(sources))
		}
	}
	return paths, nil
}

func NewLocalMergeAdapter(artifacts *localartifact.Store) *LocalMergeAdapter {
	workRoot := os.TempDir()
	if artifacts != nil && strings.TrimSpace(artifacts.Root()) != "" {
		workRoot = artifacts.Root()
	}
	// A container restart bypasses run's deferred RemoveAll and used to leave
	// downloaded source clips in the artifact volume indefinitely. Recover only
	// old, specifically named workspaces; finished merge_*.mp4 artifacts remain
	// owned by the retention ledger and are never touched here.
	_ = reclaimStaleLocalMergeWorkspaces(workRoot, time.Now())
	return &LocalMergeAdapter{
		Artifacts:  artifacts,
		Downloader: safeLocalMergeDownloader{delegate: &mergeworker.Downloader{}},
		Merger:     &mergeworker.FFmpegRunner{},
		WorkRoot:   workRoot,
		tasks:      map[string]MergeJob{},
	}
}

func reclaimStaleLocalMergeWorkspaces(root string, now time.Time) error {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil
	}
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	cutoff := now.Add(-localMergeWorkspaceRecoveryAge)
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "qiantie-local-merge-") {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil || info.ModTime().After(cutoff) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(root, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func (a *LocalMergeAdapter) Submit(_ context.Context, batchID string, sources []MergeMedia, options MergeOptions) (MergeJob, error) {
	if a == nil || a.Artifacts == nil || a.Downloader == nil || a.Merger == nil {
		return MergeJob{}, ErrUnavailable
	}
	if strings.TrimSpace(batchID) == "" || len(sources) == 0 {
		return MergeJob{}, fmt.Errorf("%w: merge batch and sources are required", ErrInvalid)
	}
	taskID, err := localMergeID("local-merge")
	if err != nil {
		return MergeJob{}, err
	}
	job := MergeJob{ProviderTaskID: taskID, Status: MergeQueued, ProgressPhase: "queued", ProgressTotal: len(sources)}
	a.mu.Lock()
	a.tasks[taskID] = job
	a.mu.Unlock()
	go a.run(taskID, strings.TrimSpace(batchID), append([]MergeMedia(nil), sources...), options)
	return job, nil
}

func (a *LocalMergeAdapter) Poll(_ context.Context, _ string, job MergeJob) (MergeJob, error) {
	if a == nil {
		return MergeJob{}, ErrUnavailable
	}
	a.mu.RLock()
	result, ok := a.tasks[job.ProviderTaskID]
	a.mu.RUnlock()
	if !ok {
		return MergeJob{ProviderTaskID: job.ProviderTaskID, Status: MergeFailed, ErrorMessage: "本地合成执行器已重启，请重新合成"}, nil
	}
	return result, nil
}

func (a *LocalMergeAdapter) run(taskID, batchID string, sources []MergeMedia, options MergeOptions) {
	a.update(taskID, func(job *MergeJob) { job.Status, job.ProgressPhase, job.ErrorMessage = MergeRunning, "downloading", "" })
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	root := strings.TrimSpace(a.WorkRoot)
	if root == "" {
		root = os.TempDir()
	}
	// 容器重建后挂载的工作目录可能还不存在（首次部署/新卷），先确保它被创建，
	// 否则 MkdirTemp 会直接报 "stat ...: no such file or directory"，所有合成全挂。
	if err := os.MkdirAll(root, 0o700); err != nil {
		a.fail(taskID, err)
		return
	}
	dir, err := os.MkdirTemp(root, "qiantie-local-merge-")
	if err != nil {
		a.fail(taskID, err)
		return
	}
	defer os.RemoveAll(dir)
	inputs, err := a.Downloader.Download(ctx, sources, dir, func(current, total int) {
		a.update(taskID, func(job *MergeJob) {
			job.Status, job.ProgressPhase, job.ProgressCurrent, job.ProgressTotal = MergeRunning, "downloading", current, total
		})
	})
	if err != nil {
		a.fail(taskID, err)
		return
	}
	a.update(taskID, func(job *MergeJob) {
		job.Status, job.ProgressPhase, job.ProgressCurrent, job.ProgressTotal = MergeRunning, "merging", len(sources), len(sources)
	})
	outputPath := filepath.Join(dir, "merged.mp4")
	speed := options.Speed
	if speed == 0 {
		speed = 1
	}
	var mergeErr error
	if runner, ok := a.Merger.(aspectAwareLocalMergeRunner); ok {
		mergeErr = runner.MergeWithAspect(ctx, inputs, outputPath, speed, options.AspectRatio)
	} else {
		mergeErr = a.Merger.Merge(ctx, inputs, outputPath, speed)
	}
	if mergeErr != nil {
		a.fail(taskID, mergeErr)
		return
	}
	outputURL := ""
	if a.Output != nil {
		outputURL, err = a.Output.PutMerged(ctx, taskID, outputPath)
		if err != nil {
			a.fail(taskID, err)
			return
		}
		outputURL = strings.TrimSpace(outputURL)
		if outputURL == "" {
			a.fail(taskID, fmt.Errorf("remote merge output URL is empty"))
			return
		}
		if strings.HasPrefix(outputURL, "tos://") {
			// Private buckets are served by the authenticated merge-media route;
			// do not expose an unusable bucket URL to the browser.
			outputURL = "/api/batch-factory/v11/batches/" + batchID + "/merge-media/" + taskID
		}
	} else {
		file, openErr := os.Open(outputPath)
		if openErr != nil {
			a.fail(taskID, openErr)
			return
		}
		defer file.Close()
		artifactID, idErr := localMergeID("merge")
		if idErr != nil {
			a.fail(taskID, idErr)
			return
		}
		if _, saveErr := a.Artifacts.SaveMP4(artifactID, file); saveErr != nil {
			a.fail(taskID, saveErr)
			return
		}
		outputURL = "/api/batch-factory/v11/batches/" + batchID + "/merge-media/" + artifactID
	}
	a.update(taskID, func(job *MergeJob) {
		job.Status, job.ProgressPhase, job.ProgressCurrent, job.ProgressTotal = MergeSucceeded, "completed", len(sources), len(sources)
		job.OutputURL = outputURL
		job.ErrorMessage = ""
	})
}

func (a *LocalMergeAdapter) update(taskID string, update func(*MergeJob)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	job, ok := a.tasks[taskID]
	if !ok {
		return
	}
	update(&job)
	a.tasks[taskID] = job
}

func (a *LocalMergeAdapter) fail(taskID string, err error) {
	a.update(taskID, func(job *MergeJob) {
		job.Status, job.ProgressPhase = MergeFailed, "failed"
		job.OutputURL = ""
		if err == nil {
			job.ErrorMessage = "本地合成失败，请检查分镜主视频后重试"
			return
		}
		job.ErrorMessage = "本地合成失败：" + strings.TrimSpace(err.Error())
	})
}

func localMergeID(prefix string) (string, error) {
	raw := make([]byte, 18)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(raw), nil
}
