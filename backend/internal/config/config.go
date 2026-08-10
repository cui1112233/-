package config

import (
	"fmt"
	"os"
)

type Config struct {
	Addr          string
	MySQLDSN      string
	SeedUsername  string
	SeedPassword  string
	TokenSecret   string
	LegacyDataDir string
}

func Load() (Config, error) {
	cfg := Config{
		Addr:          getenv("QIANTIE_ADDR", "127.0.0.1:4000"),
		MySQLDSN:      getenv("QIANTIE_MYSQL_DSN", ""),
		SeedUsername:  getenv("QIANTIE_SEED_USERNAME", "choushiyiguai"),
		SeedPassword:  getenv("QIANTIE_SEED_PASSWORD", "123456"),
		TokenSecret:   getenv("QIANTIE_TOKEN_SECRET", "dev-token-secret-change-me"),
		LegacyDataDir: getenv("QIANTIE_LEGACY_DATA_DIR", "../data/users"),
	}
	if cfg.MySQLDSN == "" {
		return Config{}, fmt.Errorf("QIANTIE_MYSQL_DSN is required")
	}
	if cfg.TokenSecret == "" {
		return Config{}, fmt.Errorf("QIANTIE_TOKEN_SECRET is required")
	}
	return cfg, nil
}

func getenv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
