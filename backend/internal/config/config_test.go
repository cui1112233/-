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
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_SLICE", "4")
	if _, err := FromEnv(); err == nil {
		t.Fatal("expected invalid slice error")
	}
}

func TestFromEnvRequiresDirectorProviderForSliceTwo(t *testing.T) {
	t.Setenv("QIANTIE_MYSQL_DSN", "user:pass@tcp(mysql:3306)/qiantie")
	t.Setenv("QIANTIE_BRIDGE_SECRET", "secret")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_SLICE", "2")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_TEXT_ENDPOINT", "")
	if _, err := FromEnv(); err == nil { t.Fatal("expected missing Director provider error") }
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_TEXT_ENDPOINT", "https://example.com/v1/chat/completions")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_TEXT_API_KEY", "test-key")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_TEXT_MODEL", "test-model")
	if _, err := FromEnv(); err != nil { t.Fatalf("unexpected configured Slice 2 error: %v", err) }
}

func TestFromEnvAcceptsProductionSliceFourOnlyWithVideoProvider(t *testing.T) {
	t.Setenv("QIANTIE_MYSQL_DSN", "user:pass@tcp(mysql:3306)/qiantie")
	t.Setenv("QIANTIE_BRIDGE_SECRET", "secret")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_SLICE", "4")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_TEXT_ENDPOINT", "https://example.com/v1/chat/completions")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_TEXT_API_KEY", "text-key")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_TEXT_MODEL", "text-model")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_VIDEO_ENDPOINT", "https://video.example/v1/generate")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_VIDEO_POLL_ENDPOINT", "https://video.example/v1/tasks/{id}")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_VIDEO_API_KEY", "video-key")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_VIDEO_MODEL", "video-model")
	t.Setenv("QIANTIE_BATCH_FACTORY_V11_PRODUCTION_ENABLED", "1")
	cfg, err := FromEnv()
	if err != nil { t.Fatal(err) }
	if cfg.Slice != 4 || !cfg.ProductionEnabled || cfg.VideoModel != "video-model" { t.Fatalf("cfg=%+v", cfg) }
}
