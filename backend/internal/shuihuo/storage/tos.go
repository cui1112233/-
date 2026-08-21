package storage

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/volcengine/ve-tos-golang-sdk/v2/tos"
	"github.com/volcengine/ve-tos-golang-sdk/v2/tos/enum"
)

type TOSConfig struct {
	Bucket    string
	Endpoint  string
	Region    string
	AccessKey string
	SecretKey string
}

func NewTOS(cfg TOSConfig) (ObjectStorage, error) {
	cfg.Bucket = strings.TrimSpace(cfg.Bucket)
	cfg.Endpoint = strings.TrimSpace(cfg.Endpoint)
	cfg.Region = strings.TrimSpace(cfg.Region)
	cfg.AccessKey = strings.TrimSpace(cfg.AccessKey)
	cfg.SecretKey = strings.TrimSpace(cfg.SecretKey)
	if cfg.Bucket == "" || cfg.Endpoint == "" || cfg.Region == "" || cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, fmt.Errorf("TOS storage configuration: %w", ErrStorageNotConfigured)
	}
	client, err := tos.NewClientV2(
		cfg.Endpoint,
		tos.WithRegion(cfg.Region),
		tos.WithCredentials(tos.NewStaticCredentials(cfg.AccessKey, cfg.SecretKey)),
	)
	if err != nil {
		return nil, fmt.Errorf("initialize TOS storage: %w", err)
	}
	return &TOS{bucket: cfg.Bucket, client: client}, nil
}

// TOS stores private objects through Volcengine's official Go SDK. Browser
// clients never receive credentials; URL returns only a time-limited GET URL.
type TOS struct {
	bucket string
	client *tos.ClientV2
}

func (s *TOS) Put(ctx context.Context, key string, body io.Reader, contentType string) (Object, error) {
	if err := ctx.Err(); err != nil {
		return Object{}, err
	}
	if !validObjectKey(key) {
		return Object{}, ErrInvalidObjectKey
	}
	if body == nil {
		return Object{}, fmt.Errorf("TOS object body is required")
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	size, hasSize := readerRemainingSize(body)
	input := &tos.PutObjectV2Input{
		PutObjectBasicInput: tos.PutObjectBasicInput{
			Bucket:      s.bucket,
			Key:         key,
			ContentType: contentType,
		},
		Content: body,
	}
	if hasSize {
		input.ContentLength = size
	}
	if _, err := s.client.PutObjectV2(ctx, input); err != nil {
		return Object{}, fmt.Errorf("put TOS object: %w", err)
	}
	if !hasSize {
		size = 0
	}
	return Object{Key: key, Size: size, ContentType: contentType}, nil
}

func (s *TOS) Get(ctx context.Context, key string) (io.ReadCloser, Object, error) {
	if err := ctx.Err(); err != nil {
		return nil, Object{}, err
	}
	if !validObjectKey(key) {
		return nil, Object{}, ErrInvalidObjectKey
	}
	result, err := s.client.GetObjectV2(ctx, &tos.GetObjectV2Input{Bucket: s.bucket, Key: key})
	if err != nil {
		return nil, Object{}, fmt.Errorf("get TOS object: %w", err)
	}
	return result.Content, Object{Key: key, Size: result.ContentLength, ContentType: result.ContentType}, nil
}

func (s *TOS) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !validObjectKey(key) {
		return ErrInvalidObjectKey
	}
	if _, err := s.client.DeleteObjectV2(ctx, &tos.DeleteObjectV2Input{Bucket: s.bucket, Key: key}); err != nil {
		return fmt.Errorf("delete TOS object: %w", err)
	}
	return nil
}

func (s *TOS) URL(ctx context.Context, key string, expiry time.Duration) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if !validObjectKey(key) {
		return "", ErrInvalidObjectKey
	}
	if expiry <= 0 {
		return "", fmt.Errorf("TOS signed URL expiry must be positive")
	}
	seconds := int64(expiry / time.Second)
	if seconds < 1 || seconds > 7*24*60*60 {
		return "", fmt.Errorf("TOS signed URL expiry must be between 1 second and 7 days")
	}
	result, err := s.client.PreSignedURL(&tos.PreSignedURLInput{
		HTTPMethod: enum.HttpMethodGet,
		Bucket:     s.bucket,
		Key:        key,
		Expires:    seconds,
	})
	if err != nil {
		return "", fmt.Errorf("sign TOS object URL: %w", err)
	}
	return result.SignedUrl, nil
}

func readerRemainingSize(reader io.Reader) (int64, bool) {
	seeker, ok := reader.(io.Seeker)
	if !ok {
		return 0, false
	}
	current, err := seeker.Seek(0, io.SeekCurrent)
	if err != nil {
		return 0, false
	}
	end, err := seeker.Seek(0, io.SeekEnd)
	if err != nil {
		return 0, false
	}
	if _, err := seeker.Seek(current, io.SeekStart); err != nil {
		return 0, false
	}
	return end - current, true
}
