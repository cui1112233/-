package main

import (
	"errors"
	"path/filepath"
	"testing"

	"qiantie/giant-material-executor/internal/agent"
	"qiantie/giant-material-executor/internal/credential"
)

func TestConfiguredPairingCodeTrimsEnvironment(t *testing.T) {
	t.Setenv("GIANT_MATERIAL_EXECUTOR_PAIRING_CODE", "  ABCD-1234  ")
	if got := configuredPairingCode(); got != "ABCD-1234" {
		t.Fatalf("pairing code=%q, want trimmed code", got)
	}
}

func TestConfiguredPairingCodeIsEmptyWithoutEnvironment(t *testing.T) {
	t.Setenv("GIANT_MATERIAL_EXECUTOR_PAIRING_CODE", "  ")
	if got := configuredPairingCode(); got != "" {
		t.Fatalf("pairing code=%q, want empty", got)
	}
}

func TestUnauthorizedRunClearsSavedCredential(t *testing.T) {
	store := credential.NewFileStore(filepath.Join(t.TempDir(), "executor.credential"))
	if err := savePairResult(store, agent.PairResult{ExecutorID: "executor-1", Token: "long-lived-token"}); err != nil {
		t.Fatalf("save pair result: %v", err)
	}
	if got := handleAgentRunError(store, agent.ErrUnauthorized); got != agent.BindingNeedsPairing {
		t.Fatalf("binding state=%s, want %s", got, agent.BindingNeedsPairing)
	}
	if _, err := store.Load(); !errors.Is(err, credential.ErrNotFound) {
		t.Fatalf("credential after unauthorized=%v, want ErrNotFound", err)
	}
}

func TestSavePairResultAndRestoreCredential(t *testing.T) {
	store := credential.NewFileStore(filepath.Join(t.TempDir(), "executor.credential"))
	result := agent.PairResult{ExecutorID: "executor-1", Token: "long-lived-token"}

	if err := savePairResult(store, result); err != nil {
		t.Fatalf("save pair result: %v", err)
	}
	got, err := loadExecutorCredential(store)
	if err != nil {
		t.Fatalf("load credential: %v", err)
	}
	if got.ExecutorID != result.ExecutorID || got.Token != result.Token {
		t.Fatalf("credential=%+v, want executor=%q token=%q", got, result.ExecutorID, result.Token)
	}
}

func TestLoadExecutorCredentialKeepsFirstLaunchUnpaired(t *testing.T) {
	store := credential.NewFileStore(filepath.Join(t.TempDir(), "executor.credential"))
	if _, err := loadExecutorCredential(store); err != credential.ErrNotFound {
		t.Fatalf("load error=%v, want ErrNotFound", err)
	}
}

func TestSavePairResultRejectsMissingServerCredential(t *testing.T) {
	store := credential.NewFileStore(filepath.Join(t.TempDir(), "executor.credential"))
	if err := savePairResult(store, agent.PairResult{ExecutorID: "executor-1"}); err == nil {
		t.Fatal("expected missing token to fail")
	}
}
