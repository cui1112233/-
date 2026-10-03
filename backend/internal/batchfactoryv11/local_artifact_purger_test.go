package batchfactoryv11

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"qiantie/backend/internal/localartifact"
)

type recordingLocalArtifactPurgeRepository struct {
	items   []LocalArtifactPurge
	deleted []int64
	retries []int64
}

func (r *recordingLocalArtifactPurgeRepository) ClaimDueLocalArtifactPurge(_ context.Context) (LocalArtifactPurge, bool, error) {
	if len(r.items) == 0 {
		return LocalArtifactPurge{}, false, nil
	}
	item := r.items[0]
	r.items = r.items[1:]
	return item, true, nil
}

func (r *recordingLocalArtifactPurgeRepository) MarkLocalArtifactPurgeDeleted(_ context.Context, id int64) error {
	r.deleted = append(r.deleted, id)
	return nil
}

func (r *recordingLocalArtifactPurgeRepository) MarkLocalArtifactPurgeRetry(_ context.Context, id int64, _ error) error {
	r.retries = append(r.retries, id)
	return nil
}

func TestLocalArtifactPurgerDeletesOnlyDueLedgerFile(t *testing.T) {
	root := t.TempDir()
	storageRef := "merge_due123.mp4"
	path := filepath.Join(root, storageRef)
	if err := os.WriteFile(path, []byte("merged"), 0o600); err != nil {
		t.Fatal(err)
	}
	repo := &recordingLocalArtifactPurgeRepository{items: []LocalArtifactPurge{{ID: 7, StorageRef: storageRef}}}
	purger := LocalArtifactPurger{Repository: repo, Artifacts: localartifact.NewStore(root, 1<<20)}
	summary, err := purger.RunOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if summary.Deleted != 1 || len(repo.deleted) != 1 || repo.deleted[0] != 7 || len(repo.retries) != 0 {
		t.Fatalf("summary=%+v deleted=%v retries=%v", summary, repo.deleted, repo.retries)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("artifact still exists or stat failed: %v", err)
	}
}

func TestLocalArtifactPurgerLeavesInvalidReferenceRetryable(t *testing.T) {
	repo := &recordingLocalArtifactPurgeRepository{items: []LocalArtifactPurge{{ID: 8, StorageRef: "../sessions.json"}}}
	purger := LocalArtifactPurger{Repository: repo, Artifacts: localartifact.NewStore(t.TempDir(), 1<<20)}
	summary, err := purger.RunOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if summary.Retried != 1 || len(repo.deleted) != 0 || len(repo.retries) != 1 || repo.retries[0] != 8 {
		t.Fatalf("summary=%+v deleted=%v retries=%v", summary, repo.deleted, repo.retries)
	}
}
