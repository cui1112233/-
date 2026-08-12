package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Local struct {
	root          string
	publicBaseURL string
}

func NewLocal(root, publicBaseURL string) *Local {
	return &Local{root: filepath.Clean(root), publicBaseURL: strings.TrimRight(publicBaseURL, "/")}
}

func (s *Local) Put(ctx context.Context, key string, body io.Reader, contentType string) (Object, error) {
	if err := ctx.Err(); err != nil {
		return Object{}, err
	}
	target, err := s.pathFor(key)
	if err != nil {
		return Object{}, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return Object{}, fmt.Errorf("create object directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".upload-*")
	if err != nil {
		return Object{}, fmt.Errorf("create object temp file: %w", err)
	}
	tempName := temporary.Name()
	defer os.Remove(tempName)

	size, copyErr := io.Copy(temporary, body)
	closeErr := temporary.Close()
	if copyErr != nil {
		return Object{}, fmt.Errorf("write object: %w", copyErr)
	}
	if closeErr != nil {
		return Object{}, fmt.Errorf("close object: %w", closeErr)
	}
	if err := os.Chmod(tempName, 0o640); err != nil {
		return Object{}, fmt.Errorf("set object permissions: %w", err)
	}
	if err := os.Rename(tempName, target); err != nil {
		return Object{}, fmt.Errorf("commit object: %w", err)
	}
	return Object{Key: key, Size: size, ContentType: contentType}, nil
}

func (s *Local) Get(ctx context.Context, key string) (io.ReadCloser, Object, error) {
	if err := ctx.Err(); err != nil {
		return nil, Object{}, err
	}
	target, err := s.pathFor(key)
	if err != nil {
		return nil, Object{}, err
	}
	file, err := os.Open(target)
	if err != nil {
		return nil, Object{}, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, Object{}, err
	}
	return file, Object{Key: key, Size: info.Size()}, nil
}

func (s *Local) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	target, err := s.pathFor(key)
	if err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *Local) URL(ctx context.Context, key string, _ time.Duration) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if _, err := s.pathFor(key); err != nil {
		return "", err
	}
	if s.publicBaseURL == "" {
		return "", fmt.Errorf("local object URL base is required")
	}
	return s.publicBaseURL + "/api/shuihuo-production/objects?" + url.Values{"key": []string{key}}.Encode(), nil
}

func (s *Local) pathFor(key string) (string, error) {
	if !validObjectKey(key) {
		return "", ErrInvalidObjectKey
	}
	target := filepath.Join(s.root, filepath.FromSlash(key))
	relative, err := filepath.Rel(s.root, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", ErrInvalidObjectKey
	}
	return target, nil
}
