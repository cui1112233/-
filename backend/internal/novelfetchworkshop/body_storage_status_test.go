package novelfetchworkshop

import (
	"context"
	"testing"
	"time"
)

func TestMemoryStoreBodyStorageStatusUsesBodyStoreNotHistory(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	now := time.Date(2026, 9, 2, 16, 30, 0, 0, time.UTC)

	if _, err := store.PutBody(ctx, "alice", BodyRecord{BookID: "1", BodyRef: BodyRef{VersionID: "original"}, Content: "第一份正文"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutBody(ctx, "alice", BodyRecord{BookID: "2", BodyRef: BodyRef{VersionID: "ai3"}, Content: "第二份正文内容更多"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.MarkBodyReleasable(ctx, "alice", "2", "ai3", now.Add(-8*24*time.Hour), 7); err != nil {
		t.Fatal(err)
	}

	status, err := store.GetBodyStorageStatus(ctx, "alice", now)
	if err != nil {
		t.Fatal(err)
	}
	if status.BodyCount != 2 {
		t.Fatalf("bodyCount=%d", status.BodyCount)
	}
	if status.CharCount <= 0 || status.StorageBytes <= 0 {
		t.Fatalf("status=%+v", status)
	}
	if status.ReleasableCount != 1 || status.ExpiredCount != 1 {
		t.Fatalf("status=%+v", status)
	}

	// 容量统计必须来自独立 Body Store；没有历史文档也仍然能看到真实占用。
	if documents, err := store.ListDocuments(ctx, "alice"); err != nil || len(documents) != 0 {
		t.Fatalf("documents=%+v err=%v", documents, err)
	}
}
