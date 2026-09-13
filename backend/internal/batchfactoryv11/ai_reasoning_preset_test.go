package batchfactoryv11

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestAIReasoningPresetConfigVersionIsPrivateAndRenameable(t *testing.T) {
	store := NewMemoryStore()
	config, _ := json.Marshal(map[string]any{
		"type":           "ai-reasoning-preset",
		"aiPromptConfig": map[string]any{"constraints": map[string]any{"enabled": true}},
	})
	created, err := store.CreateConfigVersion(context.Background(), "alice", ConfigVersion{Name: "前贴约束 V1", Config: config})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.Name != "前贴约束 V1" {
		t.Fatalf("created=%+v", created)
	}
	batch, _ := store.CreateBatch(context.Background(), "alice", CreateBatchInput{Title: "batch"})
	if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{Patch: SettingsPatch{VersionConfigIDKey: raw(created.ID)}, ExpectedRevision: batch.Revision}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("AI preset must not be accepted as an engine config, err=%v", err)
	}
	versions, _ := store.ConfigVersions(context.Background(), "bob")
	if containsConfigVersion(versions, created.ID) {
		t.Fatal("private preset leaked to another owner")
	}
	renamed, err := store.RenameConfigVersion(context.Background(), "alice", created.ID, "前贴约束 V2")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != "前贴约束 V2" {
		t.Fatalf("renamed=%+v", renamed)
	}
	if _, err := store.RenameConfigVersion(context.Background(), "bob", created.ID, "bad"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err=%v", err)
	}
}
