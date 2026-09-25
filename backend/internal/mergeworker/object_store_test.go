package mergeworker

import (
	"context"
	"io"
	"path/filepath"
	"strings"
	"testing"
)

func TestMergeObjectKeyIsDeterministicAndSafe(t *testing.T) {
	got, err := MergeObjectKey("merge-task-123")
	if err != nil {
		t.Fatal(err)
	}
	if got != "batch-merged/merge-task-123.mp4" {
		t.Fatalf("key=%q", got)
	}
	if _, err := MergeObjectKey("../bad"); err == nil {
		t.Fatal("expected unsafe task id rejection")
	}
}

func TestTOSObjectStoreUsesPrivateMarkerOnlyAfterReadableVerification(t *testing.T) {
	file := filepath.Join(t.TempDir(), "merged.mp4")
	verified := false
	store := &TOSObjectStore{
		Bucket:  "bucket-a",
		PutFile: func(context.Context, string, string, string, string) error { return nil },
		OpenFile: func(_ context.Context, key string) (io.ReadCloser, error) {
			if key != "batch-merged/merge-task-123.mp4" {
				t.Fatalf("verify key=%q", key)
			}
			verified = true
			return io.NopCloser(strings.NewReader("ok")), nil
		},
	}
	got, err := store.PutMerged(context.Background(), "merge-task-123", file)
	if err != nil {
		t.Fatal(err)
	}
	if !verified || got != "tos://bucket-a/batch-merged/merge-task-123.mp4" {
		t.Fatalf("verified=%v marker=%q", verified, got)
	}
}

func TestTOSObjectStoreReturnsPublicURL(t *testing.T) {
	file := filepath.Join(t.TempDir(), "merged.mp4")
	store := &TOSObjectStore{
		Bucket:        "bucket-a",
		PublicBaseURL: "https://cdn.example.com/media/",
		PutFile: func(_ context.Context, bucket, key, path, contentType string) error {
			if bucket != "bucket-a" || key != "batch-merged/merge-task-123.mp4" || path != file || contentType != "video/mp4" {
				t.Fatalf("upload args bucket=%q key=%q path=%q type=%q", bucket, key, path, contentType)
			}
			return nil
		},
	}
	url, err := store.PutMerged(context.Background(), "merge-task-123", file)
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://cdn.example.com/media/batch-merged/merge-task-123.mp4" {
		t.Fatalf("url=%q", url)
	}
}
