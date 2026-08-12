package storage

import (
	"context"
	"fmt"
	"io"
	"time"
)

type TOSConfig struct {
	Bucket    string
	Endpoint  string
	Region    string
	AccessKey string
	SecretKey string
}

func NewTOS(cfg TOSConfig) (ObjectStorage, error) {
	if cfg.Bucket == "" || cfg.Endpoint == "" || cfg.Region == "" || cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, fmt.Errorf("TOS storage configuration: %w", ErrStorageNotConfigured)
	}
	return nil, fmt.Errorf("TOS storage SDK is not linked: %w", ErrStorageNotConfigured)
}

type unavailableRemoteStorage struct {
	driver string
}

func (s unavailableRemoteStorage) Put(context.Context, string, io.Reader, string) (Object, error) {
	return Object{}, s.err()
}

func (s unavailableRemoteStorage) Get(context.Context, string) (io.ReadCloser, Object, error) {
	return nil, Object{}, s.err()
}

func (s unavailableRemoteStorage) Delete(context.Context, string) error {
	return s.err()
}

func (s unavailableRemoteStorage) URL(context.Context, string, time.Duration) (string, error) {
	return "", s.err()
}

func (s unavailableRemoteStorage) err() error {
	return fmt.Errorf("%s object storage SDK is not linked: %w", s.driver, ErrStorageNotConfigured)
}
