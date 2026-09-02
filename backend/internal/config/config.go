package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ListenAddr                    string
	MySQLDSN                      string
	BridgeSecret                  string
	Slice                         int
	LocalExecutorArtifactDir      string
	LocalExecutorArtifactMaxBytes int64
}

func FromEnv() (Config, error) {
	cfg := Config{
		ListenAddr:               envOr("QIANTIE_GO_LISTEN_ADDR", ":4000"),
		MySQLDSN:                 strings.TrimSpace(os.Getenv("QIANTIE_MYSQL_DSN")),
		BridgeSecret:             strings.TrimSpace(os.Getenv("QIANTIE_BRIDGE_SECRET")),
		LocalExecutorArtifactDir: envOr("QIANTIE_LOCAL_EXECUTOR_ARTIFACT_DIR", "data/local-executor-artifacts"),
	}
	if cfg.MySQLDSN == "" {
		return Config{}, fmt.Errorf("QIANTIE_MYSQL_DSN is required")
	}
	if cfg.BridgeSecret == "" {
		return Config{}, fmt.Errorf("QIANTIE_BRIDGE_SECRET is required")
	}
	rawSlice := envOr("QIANTIE_BATCH_FACTORY_V11_SLICE", "0")
	slice, err := strconv.Atoi(rawSlice)
	if err != nil || slice < 0 || slice > 2 {
		return Config{}, fmt.Errorf("invalid QIANTIE_BATCH_FACTORY_V11_SLICE")
	}
	cfg.Slice = slice
	rawArtifactMax := envOr("QIANTIE_LOCAL_EXECUTOR_ARTIFACT_MAX_BYTES", "1073741824")
	artifactMax, err := strconv.ParseInt(rawArtifactMax, 10, 64)
	if err != nil || artifactMax <= 0 {
		return Config{}, fmt.Errorf("invalid QIANTIE_LOCAL_EXECUTOR_ARTIFACT_MAX_BYTES")
	}
	cfg.LocalExecutorArtifactMaxBytes = artifactMax
	return cfg, nil
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
