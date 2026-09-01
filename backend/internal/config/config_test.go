package config

import "testing"

func TestFromEnvRequiresMySQLAndBridgeSecret(t *testing.T) {
	t.Setenv("QIANTIE_MYSQL_DSN", "")
	t.Setenv("QIANTIE_BRIDGE_SECRET", "")
	if _, err := FromEnv(); err == nil {
		t.Fatal("expected missing DSN error")
	}
	t.Setenv("QIANTIE_MYSQL_DSN", "user:pass@tcp(mysql:3306)/qiantie")
	if _, err := FromEnv(); err == nil {
		t.Fatal("expected missing bridge secret error")
	}
}

func TestFromEnvRejectsUnreleasedSliceNumber(t *testing.T) {
	t.Setenv("QIANTIE_MYSQL_DSN", "user:pass@tcp(mysql:3306)/qiantie")
	t.Setenv("QIANTIE_BRIDGE_SECRET", "secret")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_SLICE", "3")
	if _, err := FromEnv(); err == nil {
		t.Fatal("expected invalid slice error")
	}
}

func TestFromEnvProvidesLocalExecutorArtifactDefaults(t *testing.T) {
	t.Setenv("QIANTIE_MYSQL_DSN", "user:pass@tcp(mysql:3306)/qiantie")
	t.Setenv("QIANTIE_BRIDGE_SECRET", "secret")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_SLICE", "0")
	t.Setenv("QIANTIE_LOCAL_EXECUTOR_ARTIFACT_DIR", "")
	t.Setenv("QIANTIE_LOCAL_EXECUTOR_ARTIFACT_MAX_BYTES", "")
	cfg, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LocalExecutorArtifactDir != "data/local-executor-artifacts" {
		t.Fatalf("dir=%q", cfg.LocalExecutorArtifactDir)
	}
	if cfg.LocalExecutorArtifactMaxBytes != 1<<30 {
		t.Fatalf("max=%d", cfg.LocalExecutorArtifactMaxBytes)
	}
}

func TestFromEnvReadsAndValidatesLocalExecutorArtifactSettings(t *testing.T) {
	t.Setenv("QIANTIE_MYSQL_DSN", "user:pass@tcp(mysql:3306)/qiantie")
	t.Setenv("QIANTIE_BRIDGE_SECRET", "secret")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_SLICE", "0")
	t.Setenv("QIANTIE_LOCAL_EXECUTOR_ARTIFACT_DIR", "/srv/qiantie-artifacts")
	t.Setenv("QIANTIE_LOCAL_EXECUTOR_ARTIFACT_MAX_BYTES", "524288000")
	cfg, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LocalExecutorArtifactDir != "/srv/qiantie-artifacts" || cfg.LocalExecutorArtifactMaxBytes != 524288000 {
		t.Fatalf("cfg=%+v", cfg)
	}

	t.Setenv("QIANTIE_LOCAL_EXECUTOR_ARTIFACT_MAX_BYTES", "0")
	if _, err := FromEnv(); err == nil {
		t.Fatal("expected invalid artifact max bytes")
	}
}
