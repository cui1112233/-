package giantmaterialexecutor

import (
	"context"
	"testing"
	"time"
)

func seedDuplicateSetup(t *testing.T, now time.Time) (*MemoryStore, string, []string) {
	t.Helper()
	store := NewMemoryStore()
	versions := []string{"0.3.0", "0.4.2", "0.4.3", "0.4.9"}
	jobIDs := make([]string, 0, len(versions))
	for index, version := range versions {
		executorID := "gme_executor_dup_" + version
		created := now.Add(time.Duration(index) * time.Minute)
		record := ExecutorRecord{
			ID: executorID, OwnerUsername: "alice", Platform: PlatformGiantMaterial,
			TokenHash: hashSecret(version + "win-box"), DeviceName: "win-box",
			OS: "windows", Version: version, CreatedAt: created, UpdatedAt: created,
		}
		store.executors[executorID] = record
		store.tokens[secretHashKey(record.TokenHash)] = executorID
		jobID := "gme_job_dup_" + version
		leaseExpires := now.Add(JobLeaseTTL)
		store.jobs[jobID] = JobRecord{
			ID: jobID, OwnerUsername: "alice", Platform: PlatformGiantMaterial,
			MaterialID: "m-" + version, PlatformBookID: "b-" + version, Title: "测试书",
			State: JobLeased, LeaseExecutorID: executorID, LeaseGeneration: 1,
			LeaseExpiresAt: &leaseExpires, CreatedAt: created, UpdatedAt: created,
		}
		store.jobKeys["alice\x00"+jobKey(store.jobs[jobID])] = jobID
		store.progressChanged[jobID] = created
		jobIDs = append(jobIDs, jobID)
	}
	return store, "win-box", jobIDs
}

func TestConsolidateMergesDuplicatesToLatestVersion(t *testing.T) {
	now := time.Date(2026, 10, 1, 13, 0, 0, 0, time.UTC)
	store, _, jobIDs := seedDuplicateSetup(t, now)
	service := NewService(store, func() time.Time { return now })
	merged, err := service.ConsolidateExecutors(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if merged != 3 {
		t.Fatalf("merged=%d", merged)
	}
	executors, err := service.ListExecutors(context.Background(), "alice")
	if err != nil || len(executors) != 1 {
		t.Fatalf("executors=%+v err=%v", executors, err)
	}
	if executors[0].Version != "0.4.9" {
		t.Fatalf("kept version=%s", executors[0].Version)
	}
	for _, jobID := range jobIDs {
		record, err := store.JobForOwner(context.Background(), "alice", jobID)
		if err != nil {
			t.Fatal(err)
		}
		if record.LeaseExecutorID != executors[0].ID {
			t.Fatalf("job %s lease=%s not migrated", jobID, record.LeaseExecutorID)
		}
	}
	again, err := service.ConsolidateExecutors(context.Background())
	if err != nil || again != 0 {
		t.Fatalf("second run=%d err=%v", again, err)
	}
}

func TestListExecutorsExposesRecentFailure(t *testing.T) {
	now := time.Date(2026, 10, 1, 13, 30, 0, 0, time.UTC)
	service := NewService(NewMemoryStore(), func() time.Time { return now })
	token := pairExecutorVersion(t, service, "alice", "windows", "win-box", "0.4.9")
	job, err := service.CreateJob(context.Background(), "alice", testJobInput("m-fail", "b-fail"))
	if err != nil {
		t.Fatal(err)
	}
	claim, err := service.Claim(context.Background(), token)
	if err != nil {
		t.Fatal(err)
	}
	lease := LeaseCredential{Token: claim.LeaseToken, Generation: claim.LeaseGeneration}
	if err := service.Fail(context.Background(), token, job.ID, lease,
		FailureInput{Code: "x", Message: "boom"}); err != nil {
		t.Fatal(err)
	}
	executors, err := service.ListExecutors(context.Background(), "alice")
	if err != nil || len(executors) != 1 || executors[0].RecentFailureAt == nil {
		t.Fatalf("executors=%+v err=%v", executors, err)
	}
}
