package storage

import "fmt"

type MinIOConfig struct {
	Bucket    string
	Endpoint  string
	AccessKey string
	SecretKey string
}

func NewMinIO(cfg MinIOConfig) (ObjectStorage, error) {
	if cfg.Bucket == "" || cfg.Endpoint == "" || cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, fmt.Errorf("MinIO storage configuration: %w", ErrStorageNotConfigured)
	}
	return nil, fmt.Errorf("MinIO storage SDK is not linked: %w", ErrStorageNotConfigured)
}
