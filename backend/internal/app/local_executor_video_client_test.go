package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
	"qiantie/backend/internal/localexecutor"
)

func pairedLocalExecutorForTest(t *testing.T, available int) (*localexecutor.Service, string) {
	t.Helper()
	ctx := context.Background()
	now := time.Date(2026, 9, 9, 5, 0, 0, 0, time.UTC)
	service := localexecutor.NewService(localexecutor.NewMemoryStore(), func() time.Time { return now })
	pairing, err := service.CreatePairing(ctx, "alice", localexecutor.PlatformDoubao)
	if err != nil {
		t.Fatal(err)
	}
	paired, err := service.Pair(ctx, localexecutor.PairInput{
		Code: pairing.Code, DeviceName: "contract-device", Platform: localexecutor.PlatformDoubao,
		OS: "windows", Version: "contract-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Heartbeat(ctx, paired.Token, localexecutor.HeartbeatInput{
		DeviceName: "contract-device", OS: "windows", Version: "contract-test",
		Accounts: localexecutor.AccountStats{Total: 1, Available: available, Busy: 1 - available},
	}); err != nil {
		t.Fatal(err)
	}
	return service, paired.Token
}

func TestLocalVideoJobClientReadinessRequiresAvailableDoubaoAccount(t *testing.T) {
	ctx := context.Background()
	service, _ := pairedLocalExecutorForTest(t, 0)
	client := &localVideoJobClient{service: service}

	ready, err := client.HasOnlineVideoExecutor(ctx, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if ready {
		t.Fatal("online executor with zero available Doubao accounts must not be production-ready")
	}
}

func TestLocalVideoJobClientCarriesUnifiedModelThroughJobAndArtifactResult(t *testing.T) {
	ctx := context.Background()
	service, executorToken := pairedLocalExecutorForTest(t, 1)
	client := &localVideoJobClient{service: service}

	ready, err := client.HasOnlineVideoExecutor(ctx, "alice")
	if err != nil || !ready {
		t.Fatalf("ready=%v err=%v", ready, err)
	}

	created, err := client.CreateVideoJob(ctx, "alice", batchfactoryv11.LocalVideoJobInput{
		SourceTaskID: "bf11:batch-1:book-1:video-1",
		BatchID: "batch-1", BookID: "book-1", VideoID: "video-1",
		Model: "doubao-seedance", Prompt: "compiled unified prompt",
		Duration: 10, AspectRatio: "9:16", Resolution: "720p",
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.State != string(localexecutor.JobQueued) {
		t.Fatalf("created state=%q", created.State)
	}

	stored, err := service.GetJob(ctx, "alice", created.ID)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(stored.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["model"] != "doubao-seedance" || payload["videoId"] != "video-1" || payload["prompt"] != "compiled unified prompt" {
		t.Fatalf("unexpected local job payload: %#v", payload)
	}

	claim, err := service.ClaimJob(ctx, executorToken)
	if err != nil {
		t.Fatal(err)
	}
	lease := localexecutor.LeaseCredential{Token: claim.LeaseToken, Generation: claim.LeaseGeneration}
	for _, state := range []localexecutor.JobState{localexecutor.JobPreparing, localexecutor.JobSubmitting} {
		if err := service.RecordProgress(ctx, executorToken, created.ID, lease, state); err != nil {
			t.Fatal(err)
		}
	}
	if err := service.RecordAcceptance(ctx, executorToken, created.ID, lease, localexecutor.AcceptanceInput{AccountID: "contract-account", SubmissionID: "contract-submission"}); err != nil {
		t.Fatal(err)
	}
	for _, state := range []localexecutor.JobState{localexecutor.JobGenerating, localexecutor.JobDownloading, localexecutor.JobUploading} {
		if err := service.RecordProgress(ctx, executorToken, created.ID, lease, state); err != nil {
			t.Fatal(err)
		}
	}
	artifactID := "lea_contract_video_1"
	if _, err := service.RecordArtifact(ctx, executorToken, created.ID, lease, localexecutor.ArtifactInput{
		ID: artifactID, MediaType: "video/mp4", ByteSize: 3,
		SHA256: strings.Repeat("0", 64), StorageRef: "memory://contract/video.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	if err := service.CompleteJob(ctx, executorToken, created.ID, lease, localexecutor.ResultInput{ArtifactID: artifactID}); err != nil {
		t.Fatal(err)
	}

	completed, err := client.GetVideoJob(ctx, "alice", created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if completed.State != string(localexecutor.JobSucceeded) || completed.ArtifactID != artifactID {
		t.Fatalf("completed=%+v", completed)
	}
}
