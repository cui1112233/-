package novelfetchworkshop

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestNormalizeBodyRetentionDays(t *testing.T) {
	cases := []struct {
		name string
		in   int
		want int
	}{
		{name: "default", in: 0, want: 7},
		{name: "minimum", in: -5, want: 1},
		{name: "kept", in: 12, want: 12},
		{name: "maximum", in: 99, want: 30},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := NormalizeBodyRetentionDays(tc.in); got != tc.want {
				t.Fatalf("NormalizeBodyRetentionDays(%d)=%d want=%d", tc.in, got, tc.want)
			}
		})
	}
}

func TestMemoryStoreExpiredCleanupKeepsHistory(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	if err := store.PutDocument(ctx, "alice", Document{
		BookID: "123",
		Meta:   map[string]any{"bookName": "测试小说", "originalStatus": "done"},
		BodyRefs: map[string]BodyRef{
			"original": {VersionID: "original", State: "ready"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutBody(ctx, "alice", BodyRecord{
		BookID:  "123",
		BodyRef: BodyRef{VersionID: "original", State: "ready"},
		Content: "正文内容",
	}); err != nil {
		t.Fatal(err)
	}

	releasableAt := time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC)
	ref, err := store.MarkBodyReleasable(ctx, "alice", "123", "original", releasableAt, 0)
	if err != nil {
		t.Fatal(err)
	}
	if ref.State != "releasable" {
		t.Fatalf("state=%q", ref.State)
	}
	if ref.ReleasableAt != releasableAt.Format(time.RFC3339Nano) {
		t.Fatalf("releasableAt=%q", ref.ReleasableAt)
	}
	wantExpiry := releasableAt.Add(7 * 24 * time.Hour).Format(time.RFC3339Nano)
	if ref.ExpiresAt != wantExpiry {
		t.Fatalf("expiresAt=%q want=%q", ref.ExpiresAt, wantExpiry)
	}

	beforeExpiry, err := store.CleanupBodies(ctx, "alice", BodyCleanupRequest{
		Now:    releasableAt.Add(7*24*time.Hour - time.Nanosecond),
		Reason: BodyCleanupReasonExpired,
		Limit:  10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if beforeExpiry.Deleted != 0 {
		t.Fatalf("deleted before expiry=%d", beforeExpiry.Deleted)
	}

	afterExpiry, err := store.CleanupBodies(ctx, "alice", BodyCleanupRequest{
		Now:    releasableAt.Add(7 * 24 * time.Hour),
		Reason: BodyCleanupReasonExpired,
		Limit:  10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if afterExpiry.Deleted != 1 || len(afterExpiry.Results) != 1 || afterExpiry.Results[0].BookID != "123" || afterExpiry.Results[0].VersionID != "original" {
		t.Fatalf("cleanup result=%+v", afterExpiry)
	}
	if _, err := store.GetBody(ctx, "alice", "123", "original"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("body err=%v", err)
	}
	document, err := store.GetDocument(ctx, "alice", "123")
	if err != nil {
		t.Fatalf("history was deleted: %v", err)
	}
	if document.Meta["bookName"] != "测试小说" {
		t.Fatalf("history changed: %+v", document.Meta)
	}
	if _, exists := document.BodyRefs["original"]; exists {
		t.Fatalf("stale body ref remains after cleanup: %+v", document.BodyRefs)
	}
}

func TestMemoryStoreCapacityCleanupOnlyDeletesOldestReleasableBody(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	for _, versionID := range []string{"ai1", "ai3", "ai5"} {
		if _, err := store.PutBody(ctx, "alice", BodyRecord{
			BookID:  "456",
			BodyRef: BodyRef{VersionID: versionID, State: "ready"},
			Content: versionID + "正文",
		}); err != nil {
			t.Fatal(err)
		}
	}
	base := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)
	if _, err := store.MarkBodyReleasable(ctx, "alice", "456", "ai3", base.Add(-2*time.Hour), 30); err != nil {
		t.Fatal(err)
	}
	if _, err := store.MarkBodyReleasable(ctx, "alice", "456", "ai5", base.Add(-time.Hour), 30); err != nil {
		t.Fatal(err)
	}

	result, err := store.CleanupBodies(ctx, "alice", BodyCleanupRequest{
		Now:    base,
		Reason: BodyCleanupReasonCapacity,
		Limit:  1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Deleted != 1 || len(result.Results) != 1 || result.Results[0].VersionID != "ai3" || result.Results[0].Reason != BodyCleanupReasonCapacity {
		t.Fatalf("cleanup result=%+v", result)
	}
	if _, err := store.GetBody(ctx, "alice", "456", "ai1"); err != nil {
		t.Fatalf("active body was deleted: %v", err)
	}
	if _, err := store.GetBody(ctx, "alice", "456", "ai3"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("oldest releasable body err=%v", err)
	}
	if _, err := store.GetBody(ctx, "alice", "456", "ai5"); err != nil {
		t.Fatalf("newer releasable body should remain: %v", err)
	}
}
