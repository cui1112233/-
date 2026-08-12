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
	Storage       StorageConfig
}

type StorageConfig struct {
	Driver        string
	LocalDir      string
	PublicBaseURL string
	Bucket        string
	Endpoint      string
	Region        string
	AccessKey     string
	SecretKey     string
}

func Load() (Config, error) {
	cfg := Config{
		Addr:          getenv("QIANTIE_ADDR", "127.0.0.1:4000"),
		MySQLDSN:      getenv("QIANTIE_MYSQL_DSN", ""),
		SeedUsername:  getenv("QIANTIE_SEED_USERNAME", "choushiyiguai"),
		SeedPassword:  getenv("QIANTIE_SEED_PASSWORD", "123456"),
		TokenSecret:   getenv("QIANTIE_TOKEN_SECRET", "dev-token-secret-change-me"),
		LegacyDataDir: getenv("QIANTIE_LEGACY_DATA_DIR", "../data/users"),
		Storage: StorageConfig{
			Driver:        getenv("QIANTIE_STORAGE_DRIVER", "local"),
			LocalDir:      getenv("QIANTIE_STORAGE_LOCAL_DIR", "../data/shuihuo-objects"),
			PublicBaseURL: getenv("QIANTIE_STORAGE_PUBLIC_BASE_URL", "http://127.0.0.1:4000"),
			Bucket:        getenv("QIANTIE_STORAGE_BUCKET", ""),
			Endpoint:      getenv("QIANTIE_STORAGE_ENDPOINT", ""),
			Region:        getenv("QIANTIE_STORAGE_REGION", ""),
			AccessKey:     getenv("QIANTIE_STORAGE_ACCESS_KEY", ""),
			SecretKey:     getenv("QIANTIE_STORAGE_SECRET_KEY", ""),
		},
	}
	if cfg.MySQLDSN == "" {
		return Config{}, fmt.Errorf("QIANTIE_MYSQL_DSN is required")
	}
	if cfg.TokenSecret == "" {
		return Config{}, fmt.Errorf("QIANTIE_TOKEN_SECRET is required")
	}
	if cfg.Storage.Driver != "local" && cfg.Storage.Driver != "tos" && cfg.Storage.Driver != "minio" {
		return Config{}, fmt.Errorf("QIANTIE_STORAGE_DRIVER must be local, tos, or minio")
	}
	if cfg.Storage.Driver == "local" && cfg.Storage.LocalDir == "" {
		return Config{}, fmt.Errorf("QIANTIE_STORAGE_LOCAL_DIR is required for local storage")
	}
	if cfg.Storage.Driver != "local" {
		if cfg.Storage.Bucket == "" || cfg.Storage.Endpoint == "" || cfg.Storage.AccessKey == "" || cfg.Storage.SecretKey == "" {
			return Config{}, fmt.Errorf("QIANTIE_STORAGE_BUCKET, ENDPOINT, ACCESS_KEY, and SECRET_KEY are required for %s storage", cfg.Storage.Driver)
		}
		if cfg.Storage.Driver == "tos" && cfg.Storage.Region == "" {
			return Config{}, fmt.Errorf("QIANTIE_STORAGE_REGION is required for tos storage")
		}
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
