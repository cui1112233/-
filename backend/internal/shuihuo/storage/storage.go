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
	"source":        {},
	"images":        {},
	"videos":        {},
	"audio":         {},
	"exports":       {},
	"asset-images":  {},
	"script-videos": {},
}

// ScriptVideoObjectKey stores standalone script-page videos without creating
// an artificial Shuihuo project just to satisfy object ownership.
func ScriptVideoObjectKey(userID int64, taskID, filename string) (string, error) {
	if userID < 1 || strings.TrimSpace(taskID) == "" || !isSafeFilename(filename) {
		return "", ErrInvalidObjectKey
	}
	return fmt.Sprintf("script-videos/%d/%s/%s", userID, taskID, filename), nil
}

const maxObjectKeyLength = 768

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
	if len(key) > maxObjectKeyLength {
		return false
	}
	parts := strings.Split(key, "/")
	if len(parts) == 4 && parts[0] == "script-videos" {
		return isPositiveID(parts[1]) && parts[2] != "" && isSafeFilename(parts[3])
	}
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
	if filename != strings.TrimSpace(filename) {
		return false
	}
	if filename == "" || filename == "." || filename == ".." {
		return false
	}
	for _, character := range filename {
		if character < 0x20 || character == 0x7f {
			return false
		}
	}
	return path.Base(filename) == filename && !strings.Contains(filename, "\\")
}

// ValidObjectKey verifies keys before they are persisted for deferred cleanup.
// Object adapters already enforce this at their boundary, but a durable queue
// must not retain arbitrary paths that an administrator could later execute.
func ValidObjectKey(key string) bool { return validObjectKey(key) }
