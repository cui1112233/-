package giantmaterialexecutor

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestPairReusesSameDeviceIdentityAndInvalidatesOldToken(t *testing.T) {
	service := NewService(NewMemoryStore(), time.Now)
	first, err := service.CreatePairing(context.Background(), "alice", PlatformGiantMaterial)
	if err != nil {
		t.Fatal(err)
	}
	oldPair, err := service.Pair(context.Background(), PairInput{
		Code: first.Code, Platform: PlatformGiantMaterial,
		DeviceName: "win-box", OS: "windows", Version: "0.4.3",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CreatePairing(context.Background(), "alice", PlatformGiantMaterial)
	if err != nil {
		t.Fatal(err)
	}
	newPair, err := service.Pair(context.Background(), PairInput{
		Code: second.Code, Platform: PlatformGiantMaterial,
		DeviceName: "win-box", OS: "windows", Version: "0.4.9",
	})
	if err != nil {
		t.Fatal(err)
	}
	executors, err := service.ListExecutors(context.Background(), "alice")
	if err != nil || len(executors) != 1 {
		t.Fatalf("executors=%+v err=%v", executors, err)
	}
	if executors[0].Version != "0.4.9" || executors[0].ID != newPair.ExecutorID {
		t.Fatalf("executor=%+v", executors[0])
	}
	err = service.Heartbeat(context.Background(), oldPair.Token, HeartbeatInput{
		DeviceName: "win-box", OS: "windows", Version: "0.4.3",
	})
	if !errors.Is(err, ErrExecutorUnauthorized) {
		t.Fatalf("old token error=%v", err)
	}
	if err := service.Heartbeat(context.Background(), newPair.Token, HeartbeatInput{
		DeviceName: "win-box", OS: "windows", Version: "0.4.9",
	}); err != nil {
		t.Fatal(err)
	}
}

func TestPairDifferentOSCreatesSeparateExecutor(t *testing.T) {
	service := NewService(NewMemoryStore(), time.Now)
	first, err := service.CreatePairing(context.Background(), "alice", PlatformGiantMaterial)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Pair(context.Background(), PairInput{
		Code: first.Code, Platform: PlatformGiantMaterial,
		DeviceName: "same-name", OS: "windows", Version: "0.4.9",
	}); err != nil {
		t.Fatal(err)
	}
	second, err := service.CreatePairing(context.Background(), "alice", PlatformGiantMaterial)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Pair(context.Background(), PairInput{
		Code: second.Code, Platform: PlatformGiantMaterial,
		DeviceName: "same-name", OS: "darwin", Version: "0.5.0",
	}); err != nil {
		t.Fatal(err)
	}
	executors, err := service.ListExecutors(context.Background(), "alice")
	if err != nil || len(executors) != 2 {
		t.Fatalf("executors=%+v err=%v", executors, err)
	}
}

func TestEnsureIdentityUniqueIndexMemoryNoOp(t *testing.T) {
	if err := NewMemoryStore().EnsureIdentityUniqueIndex(context.Background()); err != nil {
		t.Fatalf("EnsureIdentityUniqueIndex memory no-op: %v", err)
	}
}
