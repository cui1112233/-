package localexecutor

import (
	"context"
	"errors"
	"testing"
	"time"
)

func acceptedUploadingJob(t *testing.T, now *time.Time) (*Service, *MemoryStore, PairResult, JobView, LeaseCredential) {
	t.Helper()
	store := NewMemoryStore()
	svc := NewService(store, func() time.Time { return *now })
	executor := pairedExecutor(t, svc, "alice", "A")
	job, err := svc.CreateJob(context.Background(), "alice", CreateJobInput{SourceTaskID: "artifact-task", Platform: PlatformDoubao})
	if err != nil {
		t.Fatal(err)
	}
	claim, err := svc.ClaimJob(context.Background(), executor.Token)
	if err != nil {
		t.Fatal(err)
	}
	lease := LeaseCredential{Token: claim.LeaseToken, Generation: claim.LeaseGeneration}
	for _, state := range []JobState{JobPreparing, JobSubmitting} {
		if err := svc.RecordProgress(context.Background(), executor.Token, job.ID, lease, state); err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.RecordAcceptance(context.Background(), executor.Token, job.ID, lease, AcceptanceInput{AccountID: "acct-1", SubmissionID: "msg-1"}); err != nil {
		t.Fatal(err)
	}
	for _, state := range []JobState{JobGenerating, JobDownloading, JobUploading} {
		if err := svc.RecordProgress(context.Background(), executor.Token, job.ID, lease, state); err != nil {
			t.Fatal(err)
		}
	}
	return svc, store, executor, job, lease
}

func TestArtifactRegistrationRequiresAcceptedUploadingJobAndActiveLease(t *testing.T) {
	now := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	svc, _, executor, job, lease := acceptedUploadingJob(t, &now)
	input := ArtifactInput{ID: "lea_one", MediaType: "video/mp4", ByteSize: 128, SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", StorageRef: "lea_one.mp4"}
	got, err := svc.RecordArtifact(context.Background(), executor.Token, job.ID, lease, input)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != input.ID || got.JobID != job.ID || got.OwnerUsername != "alice" {
		t.Fatalf("artifact=%+v", got)
	}

	now = now.Add(JobLeaseTTL + time.Second)
	_, err = svc.RecordArtifact(context.Background(), executor.Token, job.ID, lease, ArtifactInput{ID: "lea_late", MediaType: "video/mp4", ByteSize: 128, SHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", StorageRef: "lea_late.mp4"})
	if !errors.Is(err, ErrStaleLease) {
		t.Fatalf("stale lease err=%v", err)
	}
}

func TestArtifactRegistrationIsIdempotentForSameJobAndDigest(t *testing.T) {
	now := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	svc, _, executor, job, lease := acceptedUploadingJob(t, &now)
	first, err := svc.RecordArtifact(context.Background(), executor.Token, job.ID, lease, ArtifactInput{ID: "lea_first", MediaType: "video/mp4", ByteSize: 256, SHA256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", StorageRef: "lea_first.mp4"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.RecordArtifact(context.Background(), executor.Token, job.ID, lease, ArtifactInput{ID: "lea_retry", MediaType: "video/mp4", ByteSize: 256, SHA256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", StorageRef: "lea_retry.mp4"})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID || second.StorageRef != first.StorageRef {
		t.Fatalf("first=%+v second=%+v", first, second)
	}
}

func TestArtifactRegistrationFailsClosedForDifferentContent(t *testing.T) {
	now := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	svc, _, executor, job, lease := acceptedUploadingJob(t, &now)
	_, err := svc.RecordArtifact(context.Background(), executor.Token, job.ID, lease, ArtifactInput{ID: "lea_first", MediaType: "video/mp4", ByteSize: 256, SHA256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", StorageRef: "lea_first.mp4"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.RecordArtifact(context.Background(), executor.Token, job.ID, lease, ArtifactInput{ID: "lea_other", MediaType: "video/mp4", ByteSize: 300, SHA256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", StorageRef: "lea_other.mp4"})
	if !errors.Is(err, ErrArtifactConflict) {
		t.Fatalf("conflict err=%v", err)
	}
}

func TestArtifactOwnerLookupIsScoped(t *testing.T) {
	now := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	svc, _, executor, job, lease := acceptedUploadingJob(t, &now)
	artifact, err := svc.RecordArtifact(context.Background(), executor.Token, job.ID, lease, ArtifactInput{ID: "lea_owner", MediaType: "video/mp4", ByteSize: 64, SHA256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", StorageRef: "lea_owner.mp4"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.GetArtifact(context.Background(), "bob", artifact.ID); !errors.Is(err, ErrArtifactNotFound) {
		t.Fatalf("bob lookup err=%v", err)
	}
	got, err := svc.GetArtifact(context.Background(), "alice", artifact.ID)
	if err != nil || got.ID != artifact.ID {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}
