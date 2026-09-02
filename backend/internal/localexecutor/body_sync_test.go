package localexecutor

import (
	"context"
	"errors"
	"testing"
	"time"

	"qiantie/backend/internal/novelfetchworkshop"
)

func TestBodySyncClaimIsOwnerIsolatedAndAckedRevisionIsNotReclaimed(t *testing.T) {
	ctx := context.Background()
	nowValue := time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)
	now := func() time.Time { return nowValue }

	executorStore := NewMemoryStore()
	executors := NewService(executorStore, now)
	bodyStore := novelfetchworkshop.NewMemoryStore()

	aliceToken := pairTestExecutor(t, ctx, executors, "alice", nowValue, "Alice PC")
	bobToken := pairTestExecutor(t, ctx, executors, "bob", nowValue, "Bob PC")

	aliceRef, err := bodyStore.PutBody(ctx, "alice", novelfetchworkshop.BodyRecord{
		BookID: "book-a", BodyRef: novelfetchworkshop.BodyRef{VersionID: "ai3", State: "ready"}, Content: "alice正文",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bodyStore.PutDocument(ctx, "alice", novelfetchworkshop.Document{BookID: "book-a", BodyRefs: map[string]novelfetchworkshop.BodyRef{"ai3": aliceRef}}); err != nil {
		t.Fatal(err)
	}
	bobRef, err := bodyStore.PutBody(ctx, "bob", novelfetchworkshop.BodyRecord{
		BookID: "book-b", BodyRef: novelfetchworkshop.BodyRef{VersionID: "ai1", State: "ready"}, Content: "bob正文",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bodyStore.PutDocument(ctx, "bob", novelfetchworkshop.Document{BookID: "book-b", BodyRefs: map[string]novelfetchworkshop.BodyRef{"ai1": bobRef}}); err != nil {
		t.Fatal(err)
	}

	syncs := NewBodySyncService(executors, bodyStore, NewMemoryBodySyncStore(), now)
	claim, err := syncs.Claim(ctx, aliceToken)
	if err != nil {
		t.Fatal(err)
	}
	if claim.Body.BookID != "book-a" || claim.Body.VersionID != "ai3" {
		t.Fatalf("alice claimed wrong body: %+v", claim.Body)
	}
	if claim.Body.Content != "alice正文" || claim.Body.Revision != aliceRef.Revision || claim.Body.ContentHash != aliceRef.ContentHash {
		t.Fatalf("claim body mismatch: %+v ref=%+v", claim.Body, aliceRef)
	}
	if claim.LeaseToken == "" || claim.LeaseGeneration != 1 || !claim.LeaseExpiresAt.After(nowValue) {
		t.Fatalf("invalid lease: %+v", claim)
	}

	if err := syncs.Ack(ctx, bobToken, claim.SyncID, BodySyncLeaseCredential{Token: claim.LeaseToken, Generation: claim.LeaseGeneration}, BodySyncAckInput{
		Revision: claim.Body.Revision, ContentHash: claim.Body.ContentHash,
	}); !errors.Is(err, ErrStaleBodySyncLease) {
		t.Fatalf("bob ack error=%v, want stale lease", err)
	}
	if err := syncs.Ack(ctx, aliceToken, claim.SyncID, BodySyncLeaseCredential{Token: claim.LeaseToken, Generation: claim.LeaseGeneration}, BodySyncAckInput{
		Revision: claim.Body.Revision, ContentHash: claim.Body.ContentHash,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := syncs.Claim(ctx, aliceToken); !errors.Is(err, ErrNoPendingBodySync) {
		t.Fatalf("claim after ack error=%v, want no pending sync", err)
	}
}

func pairTestExecutor(t *testing.T, ctx context.Context, service *Service, owner string, now time.Time, name string) string {
	t.Helper()
	pairing, err := service.CreatePairing(ctx, owner, PlatformDoubao)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.Pair(ctx, PairInput{Code: pairing.Code, Platform: PlatformDoubao, DeviceName: name, OS: "test", Version: "1.0.0"})
	if err != nil {
		t.Fatal(err)
	}
	_ = now
	return result.Token
}
