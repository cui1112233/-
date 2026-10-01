package giantmaterialexecutor

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestPreferenceDefaultsToWindows(t *testing.T) {
	service := NewService(NewMemoryStore(), time.Now)
	view, err := service.GetPreference(context.Background(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if view.PreferredOS != "windows" {
		t.Fatalf("preferred=%s", view.PreferredOS)
	}
}

func TestSavePreferencePersistsAndOverwrites(t *testing.T) {
	clock := &testClock{now: time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)}
	service := NewService(NewMemoryStore(), clock.Now)
	first, err := service.SavePreference(context.Background(), "alice", "darwin")
	if err != nil {
		t.Fatal(err)
	}
	if first.PreferredOS != "darwin" {
		t.Fatalf("first=%s", first.PreferredOS)
	}
	again, err := service.GetPreference(context.Background(), "alice")
	if err != nil || again.PreferredOS != "darwin" {
		t.Fatalf("again=%+v err=%v", again, err)
	}
	overwritten, err := service.SavePreference(context.Background(), "alice", "WINDOWS")
	if err != nil || overwritten.PreferredOS != "windows" {
		t.Fatalf("overwritten=%+v err=%v", overwritten, err)
	}
}

func TestSavePreferenceRejectsInvalidOS(t *testing.T) {
	service := NewService(NewMemoryStore(), time.Now)
	for _, bad := range []string{"", "linux", "ios"} {
		if _, err := service.SavePreference(context.Background(), "alice", bad); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("bad %q error=%v", bad, err)
		}
	}
}

func TestStoreGetPreferenceMissingIsSentinel(t *testing.T) {
	store := NewMemoryStore()
	if _, err := store.GetPreference(context.Background(), "alice"); !errors.Is(err, ErrPreferenceNotFound) {
		t.Fatalf("error=%v", err)
	}
}
