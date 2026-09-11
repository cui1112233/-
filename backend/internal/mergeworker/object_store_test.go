package mergeworker

import (
	"context"
	"path/filepath"
	"testing"
)

func TestMergeObjectKeyIsDeterministicAndSafe(t *testing.T) {
	got, err := MergeObjectKey("merge-task-123")
	if err != nil {
		t.Fatal(err)
	}
	if got != "batch-factory-v11/merged/merge-task-123.mp4" {
		t.Fatalf("key=%q", got)
	}
	if _, err := MergeObjectKey("../bad"); err == nil {
		t.Fatal("expected unsafe task id rejection")
	}
}

func TestTOSObjectStoreReturnsPublicURL(t *testing.T) {
	file := filepath.Join(t.TempDir(), "merged.mp4")
	store := &TOSObjectStore{
		Bucket:        "bucket-a",
		PublicBaseURL: "https://cdn.example.com/media/",
		PutFile: func(_ context.Context, bucket, key, path, contentType string) error {
			if bucket != "bucket-a" || key != "batch-factory-v11/merged/merge-task-123.mp4" || path != file || contentType != "video/mp4" {
				t.Fatalf("upload args bucket=%q key=%q path=%q type=%q", bucket, key, path, contentType)
			}
			return nil
		},
	}
	url, err := store.PutMerged(context.Background(), "merge-task-123", file)
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://cdn.example.com/media/batch-factory-v11/merged/merge-task-123.mp4" {
		t.Fatalf("url=%q", url)
	}
}
