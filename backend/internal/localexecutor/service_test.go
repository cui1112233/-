package localexecutor

import (
	"context"
	"testing"
	"time"
)

func TestServiceListOnlineThresholdBoundary(t *testing.T) {
	now := time.Date(2026, 9, 9, 2, 0, 0, 0, time.UTC)
	store := NewMemoryStore()

	seenNever := (*time.Time)(nil)
	seenAt44 := now.Add(-44 * time.Second)
	seenAt45 := now.Add(-45 * time.Second)
	seenAt46 := now.Add(-46 * time.Second)
	store.executors["never"] = ExecutorRecord{ID: "never", OwnerUsername: "owner", LastSeenAt: seenNever}
	store.executors["44"] = ExecutorRecord{ID: "44", OwnerUsername: "owner", LastSeenAt: &seenAt44}
	store.executors["45"] = ExecutorRecord{ID: "45", OwnerUsername: "owner", LastSeenAt: &seenAt45}
	store.executors["46"] = ExecutorRecord{ID: "46", OwnerUsername: "owner", LastSeenAt: &seenAt46}

	service := NewService(store, func() time.Time { return now })
	views, err := service.List(context.Background(), "owner")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}

	onlineByID := make(map[string]bool, len(views))
	for _, view := range views {
		onlineByID[view.ID] = view.Online
	}

	if onlineByID["never"] {
		t.Fatal("executor without heartbeat must be offline")
	}
	if !onlineByID["44"] {
		t.Fatal("executor seen 44s ago must be online")
	}
	if !onlineByID["45"] {
		t.Fatal("executor seen exactly 45s ago must be online")
	}
	if onlineByID["46"] {
		t.Fatal("executor seen 46s ago must be offline")
	}
}
