package localexecutor

import (
	"context"
	"errors"
	"testing"
	"time"
)

func pairedExecutor(t *testing.T, svc *Service, owner, name string) PairResult {
	t.Helper()
	pairing, err := svc.CreatePairing(context.Background(), owner, PlatformDoubao)
	if err != nil {
		t.Fatal(err)
	}
	result, err := svc.Pair(context.Background(), PairInput{Code: pairing.Code, DeviceName: name, Platform: PlatformDoubao, OS: "windows", Version: "1.0.0"})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestJobClaimIsOwnerScopedAndExclusive(t *testing.T) {
	now := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	store := NewMemoryStore()
	svc := NewService(store, func() time.Time { return now })
	alice := pairedExecutor(t, svc, "alice", "A")
	bob := pairedExecutor(t, svc, "bob", "B")
	job, err := svc.CreateJob(context.Background(), "alice", CreateJobInput{SourceTaskID: "task-1", Platform: PlatformDoubao})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ClaimJob(context.Background(), bob.Token); !errors.Is(err, ErrNoClaimableJob) {
		t.Fatalf("bob claim err=%v", err)
	}
	claim, err := svc.ClaimJob(context.Background(), alice.Token)
	if err != nil {
		t.Fatal(err)
	}
	if claim.Job.ID != job.ID || claim.LeaseToken == "" || claim.LeaseGeneration != 1 {
		t.Fatalf("claim=%+v", claim)
	}
	if _, err := svc.ClaimJob(context.Background(), alice.Token); !errors.Is(err, ErrNoClaimableJob) {
		t.Fatalf("second claim err=%v", err)
	}
}

func TestStaleLeaseCannotMutateReclaimedJob(t *testing.T) {
	now := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	store := NewMemoryStore()
	svc := NewService(store, func() time.Time { return now })
	executor := pairedExecutor(t, svc, "alice", "A")
	job, _ := svc.CreateJob(context.Background(), "alice", CreateJobInput{SourceTaskID: "task-2", Platform: PlatformDoubao})
	first, _ := svc.ClaimJob(context.Background(), executor.Token)
	now = now.Add(61 * time.Second)
	second, err := svc.ClaimJob(context.Background(), executor.Token)
	if err != nil {
		t.Fatal(err)
	}
	if second.LeaseGeneration <= first.LeaseGeneration {
		t.Fatal("generation did not advance")
	}
	err = svc.RecordProgress(context.Background(), executor.Token, job.ID, LeaseCredential{Token: first.LeaseToken, Generation: first.LeaseGeneration}, JobPreparing)
	if !errors.Is(err, ErrStaleLease) {
		t.Fatalf("err=%v", err)
	}
}

func TestAcceptedJobCannotBeReleasedForFreshSubmission(t *testing.T) {
	now := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	store := NewMemoryStore()
	svc := NewService(store, func() time.Time { return now })
	executor := pairedExecutor(t, svc, "alice", "A")
	job, _ := svc.CreateJob(context.Background(), "alice", CreateJobInput{SourceTaskID: "task-3", Platform: PlatformDoubao})
	claim, _ := svc.ClaimJob(context.Background(), executor.Token)
	lease := LeaseCredential{Token: claim.LeaseToken, Generation: claim.LeaseGeneration}
	if err := svc.RecordProgress(context.Background(), executor.Token, job.ID, lease, JobPreparing); err != nil {
		t.Fatal(err)
	}
	if err := svc.RecordProgress(context.Background(), executor.Token, job.ID, lease, JobSubmitting); err != nil {
		t.Fatal(err)
	}
	if err := svc.RecordAcceptance(context.Background(), executor.Token, job.ID, lease, AcceptanceInput{AccountID: "acct-1", SubmissionID: "msg-9"}); err != nil {
		t.Fatal(err)
	}
	if err := svc.ReleaseJob(context.Background(), executor.Token, job.ID, lease, "ordinary failure"); !errors.Is(err, ErrAcceptedJobPinned) {
		t.Fatalf("release err=%v", err)
	}
}

func TestCancellationPreventsFurtherProgress(t *testing.T) {
	now := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	store := NewMemoryStore()
	svc := NewService(store, func() time.Time { return now })
	executor := pairedExecutor(t, svc, "alice", "A")
	job, _ := svc.CreateJob(context.Background(), "alice", CreateJobInput{SourceTaskID: "task-4", Platform: PlatformDoubao})
	claim, _ := svc.ClaimJob(context.Background(), executor.Token)
	lease := LeaseCredential{Token: claim.LeaseToken, Generation: claim.LeaseGeneration}
	if _, err := svc.CancelJob(context.Background(), "alice", job.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.RecordProgress(context.Background(), executor.Token, job.ID, lease, JobPreparing); !errors.Is(err, ErrJobCancelled) {
		t.Fatalf("progress err=%v", err)
	}
}
