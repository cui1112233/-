package app

import (
	"context"
	"testing"
	"time"

	"qiantie/backend/internal/localexecutor"
)

func TestLocalVideoJobClientReadinessRequiresAvailableDoubaoAccount(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 9, 9, 5, 0, 0, 0, time.UTC)
	service := localexecutor.NewService(localexecutor.NewMemoryStore(), func() time.Time { return now })
	pairing, err := service.CreatePairing(ctx, "alice", localexecutor.PlatformDoubao)
	if err != nil { t.Fatal(err) }
	paired, err := service.Pair(ctx, localexecutor.PairInput{
		Code: pairing.Code, DeviceName: "contract-device", Platform: localexecutor.PlatformDoubao,
		OS: "windows", Version: "contract-test",
	})
	if err != nil { t.Fatal(err) }
	if err := service.Heartbeat(ctx, paired.Token, localexecutor.HeartbeatInput{
		DeviceName: "contract-device", OS: "windows", Version: "contract-test",
		Accounts: localexecutor.AccountStats{Total: 1, Available: 0, Busy: 1},
	}); err != nil { t.Fatal(err) }

	client := &localVideoJobClient{service: service}
	ready, err := client.HasOnlineVideoExecutor(ctx, "alice")
	if err != nil { t.Fatal(err) }
	if ready {
		t.Fatal("online executor with zero available Doubao accounts must not be production-ready")
	}
}
