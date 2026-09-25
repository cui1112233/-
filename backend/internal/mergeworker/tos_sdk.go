package mergeworker

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/volcengine/ve-tos-golang-sdk/v2/tos"
)

type TOSConfig struct {
	Endpoint      string
	Region        string
	Bucket        string
	AccessKey     string
	SecretKey     string
	PublicBaseURL string
}

func NewTOSObjectStore(config TOSConfig) (*TOSObjectStore, error) {
	config.Endpoint = strings.TrimSpace(config.Endpoint)
	config.Region = strings.TrimSpace(config.Region)
	config.Bucket = strings.TrimSpace(config.Bucket)
	config.AccessKey = strings.TrimSpace(config.AccessKey)
	config.SecretKey = strings.TrimSpace(config.SecretKey)
	config.PublicBaseURL = strings.TrimSpace(config.PublicBaseURL)
	if config.Endpoint == "" || config.Region == "" || config.Bucket == "" || config.AccessKey == "" || config.SecretKey == "" {
		return nil, fmt.Errorf("TOS merge output configuration is incomplete")
	}
	client, err := tos.NewClientV2(
		config.Endpoint,
		tos.WithRegion(config.Region),
		tos.WithCredentials(tos.NewStaticCredentials(config.AccessKey, config.SecretKey)),
	)
	if err != nil {
		return nil, fmt.Errorf("create TOS merge output client: %w", err)
	}
	return &TOSObjectStore{
		Bucket:        config.Bucket,
		PublicBaseURL: config.PublicBaseURL,
		PutFile: func(ctx context.Context, bucket, key, filePath, _ string) error {
			_, err := client.PutObjectFromFile(ctx, &tos.PutObjectFromFileInput{
				PutObjectBasicInput: tos.PutObjectBasicInput{Bucket: bucket, Key: key},
				FilePath:            filePath,
			})
			return err
		},
		OpenFile: func(ctx context.Context, key string) (io.ReadCloser, error) {
			result, err := client.GetObjectV2(ctx, &tos.GetObjectV2Input{Bucket: config.Bucket, Key: key})
			if err != nil {
				return nil, err
			}
			return result.Content, nil
		},
	}, nil
}
