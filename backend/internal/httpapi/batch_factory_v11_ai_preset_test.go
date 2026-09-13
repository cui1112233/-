package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/batchfactoryv11"
)

func TestAIReasoningPresetConfigVersionCanBeCreatedAndRenamed(t *testing.T) {
	now := time.Unix(1700000000, 0)
	store := batchfactoryv11.NewMemoryStore()
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }, Slice: 1, Store: store})
	created := signedJSONRequest(t, api, now, "alice", http.MethodPost, "/api/batch-factory/v11/config-versions", map[string]any{
		"name": "前贴推理", "config": map[string]any{"type": "ai-reasoning-preset", "aiPromptConfig": map[string]any{"visual": map[string]any{"enabled": true}}},
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create=%d body=%s", created.Code, created.Body.String())
	}
	versions, _ := store.ConfigVersions(context.Background(), "alice")
	var id string
	for _, version := range versions {
		if version.Name == "前贴推理" {
			id = version.ID
		}
	}
	if id == "" {
		t.Fatalf("missing saved preset: %+v", versions)
	}
	renamed := signedJSONRequest(t, api, now, "alice", http.MethodPut, "/api/batch-factory/v11/config-versions/"+id, map[string]any{"name": "前贴推理 V2"})
	if renamed.Code != http.StatusOK || !strings.Contains(renamed.Body.String(), "前贴推理 V2") {
		t.Fatalf("rename=%d body=%s", renamed.Code, renamed.Body.String())
	}
}
