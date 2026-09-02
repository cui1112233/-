package localexecutor

import (
	"testing"
	"time"
)

func TestArtifactPublicTokenBindsOwnerAndArtifact(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	token, err := ArtifactPublicToken("bridge-secret", "alice", "artifact_1", now.Add(5*time.Minute))
	if err != nil { t.Fatal(err) }
	owner, err := VerifyArtifactPublicToken("bridge-secret", "artifact_1", token, now)
	if err != nil || owner != "alice" { t.Fatalf("owner=%q err=%v", owner, err) }
	if _, err := VerifyArtifactPublicToken("bridge-secret", "artifact_2", token, now); err == nil { t.Fatal("expected artifact binding failure") }
	if _, err := VerifyArtifactPublicToken("bridge-secret", "artifact_1", token, now.Add(6*time.Minute)); err == nil { t.Fatal("expected expiry failure") }
}
