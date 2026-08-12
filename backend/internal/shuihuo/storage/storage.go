package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path"
	"strconv"
	"strings"
	"time"
)

var (
	ErrInvalidObjectKey     = errors.New("invalid shuihuo object key")
	ErrStorageNotConfigured = errors.New("object storage driver is not configured")
)

type Object struct {
	Key         string
	Size        int64
	ContentType string
}

type ObjectStorage interface {
	Put(ctx context.Context, key string, body io.Reader, contentType string) (Object, error)
	Get(ctx context.Context, key string) (io.ReadCloser, Object, error)
	Delete(ctx context.Context, key string) error
	URL(ctx context.Context, key string, expiry time.Duration) (string, error)
}

var allowedCategories = map[string]struct{}{
	"source":  {},
	"images":  {},
	"videos":  {},
	"audio":   {},
	"exports": {},
}

func ObjectKey(userID, projectID int64, category, filename string) (string, error) {
	if userID < 1 || projectID < 1 {
		return "", ErrInvalidObjectKey
	}
	if _, ok := allowedCategories[category]; !ok {
		return "", ErrInvalidObjectKey
	}
	if !isSafeFilename(filename) {
		return "", ErrInvalidObjectKey
	}
	return fmt.Sprintf("shuihuo-production/%d/%d/%s/%s", userID, projectID, category, filename), nil
}

func validObjectKey(key string) bool {
	parts := strings.Split(key, "/")
	if len(parts) != 5 || parts[0] != "shuihuo-production" {
		return false
	}
	if !isPositiveID(parts[1]) || !isPositiveID(parts[2]) {
		return false
	}
	if _, ok := allowedCategories[parts[3]]; !ok {
		return false
	}
	return isSafeFilename(parts[4])
}

func isPositiveID(value string) bool {
	id, err := strconv.ParseInt(value, 10, 64)
	return err == nil && id > 0
}

func isSafeFilename(filename string) bool {
	if filename == "" || filename == "." || filename == ".." {
		return false
	}
	return path.Base(filename) == filename && !strings.Contains(filename, "\\")
}
