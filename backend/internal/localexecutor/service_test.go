package localexecutor

import (
	"context"
	"errors"
	"testing"
	"time"
)

func fixedClock(at time.Time) func() time.Time { return func() time.Time { return at } }

func TestCreatePairingReturnsPlaintextButStoresOnlyHash(t *testing.T) {
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	store := NewMemoryStore()
	svc := NewService(store, fixedClock(now))

	secret, err := svc.CreatePairing(context.Background(), "alice", "doubao")
	if err != nil {
		t.Fatal(err)
	}
	if secret.Code == "" {
		t.Fatal("missing code")
	}
	if !secret.ExpiresAt.Equal(now.Add(10 * time.Minute)) {
		t.Fatalf("expires=%v", secret.ExpiresAt)
	}
	if store.PairingPlaintextSeen(secret.Code) {
		t.Fatal("plaintext pairing code stored")
	}
}

func TestPairingIsSingleUseAndReturnsHashedTokenCredential(t *testing.T) {
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	store := NewMemoryStore()
	svc := NewService(store, fixedClock(now))
	pairing, err := svc.CreatePairing(context.Background(), "alice", "doubao")
	if err != nil {
		t.Fatal(err)
	}

	first, err := svc.Pair(context.Background(), PairInput{Code: pairing.Code, DeviceName: "DESKTOP-A", Platform: "doubao", OS: "windows", Version: "0.1.14"})
	if err != nil {
		t.Fatal(err)
	}
	if first.Token == "" || first.ExecutorID == "" {
		t.Fatalf("pair result=%+v", first)
	}
	if store.ExecutorPlaintextTokenSeen(first.Token) {
		t.Fatal("plaintext executor token stored")
	}

	_, err = svc.Pair(context.Background(), PairInput{Code: pairing.Code, DeviceName: "DESKTOP-B", Platform: "doubao"})
	if !errors.Is(err, ErrPairingInvalid) {
		t.Fatalf("second pair err=%v", err)
	}
}

func TestExpiredPairingFailsClosed(t *testing.T) {
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	store := NewMemoryStore()
	clock := now
	svc := NewService(store, func() time.Time { return clock })
	pairing, err := svc.CreatePairing(context.Background(), "alice", "doubao")
	if err != nil {
		t.Fatal(err)
	}
	clock = now.Add(10*time.Minute + time.Nanosecond)
	_, err = svc.Pair(context.Background(), PairInput{Code: pairing.Code, DeviceName: "DESKTOP-A", Platform: "doubao"})
	if !errors.Is(err, ErrPairingInvalid) {
		t.Fatalf("expired pair err=%v", err)
	}
}

func TestHeartbeatRejectsInvalidTokenAndInvalidCounters(t *testing.T) {
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	store := NewMemoryStore()
	svc := NewService(store, fixedClock(now))
	if err := svc.Heartbeat(context.Background(), "bad-token", HeartbeatInput{}); !errors.Is(err, ErrExecutorUnauthorized) {
		t.Fatalf("bad token err=%v", err)
	}

	pairing, _ := svc.CreatePairing(context.Background(), "alice", "doubao")
	paired, _ := svc.Pair(context.Background(), PairInput{Code: pairing.Code, DeviceName: "DESKTOP-A", Platform: "doubao"})
	err := svc.Heartbeat(context.Background(), paired.Token, HeartbeatInput{Accounts: AccountStats{Total: 2, Available: 3}})
	if !errors.Is(err, ErrInvalidAccountStats) {
		t.Fatalf("counter err=%v", err)
	}
}

func TestListDerivesOnlineAndIsolatesOwners(t *testing.T) {
	t0 := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	clock := t0
	store := NewMemoryStore()
	svc := NewService(store, func() time.Time { return clock })

	alicePairing, _ := svc.CreatePairing(context.Background(), "alice", "doubao")
	alice, _ := svc.Pair(context.Background(), PairInput{Code: alicePairing.Code, DeviceName: "ALICE-PC", Platform: "doubao", OS: "windows", Version: "0.1.14"})
	if err := svc.Heartbeat(context.Background(), alice.Token, HeartbeatInput{Accounts: AccountStats{Total: 3, Available: 2, Busy: 1}}); err != nil {
		t.Fatal(err)
	}

	bobPairing, _ := svc.CreatePairing(context.Background(), "bob", "doubao")
	bob, _ := svc.Pair(context.Background(), PairInput{Code: bobPairing.Code, DeviceName: "BOB-PC", Platform: "doubao"})
	if err := svc.Heartbeat(context.Background(), bob.Token, HeartbeatInput{Accounts: AccountStats{Total: 1, Available: 1}}); err != nil {
		t.Fatal(err)
	}

	clock = t0.Add(44 * time.Second)
	list, err := svc.List(context.Background(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Name != "ALICE-PC" || !list[0].Online {
		t.Fatalf("alice list=%+v", list)
	}

	clock = t0.Add(46 * time.Second)
	list, err = svc.List(context.Background(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Online {
		t.Fatalf("offline list=%+v", list)
	}
}
