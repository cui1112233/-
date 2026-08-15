package tasks

import (
	"bytes"
	"context"
	"io"
	"time"

	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
)

type ObjectStorageBridge struct {
	Store shuihuostorage.ObjectStorage
}

func (b ObjectStorageBridge) PutGenerated(ctx context.Context, key string, body []byte, contentType string) error {
	_, err := b.Store.Put(ctx, key, bytes.NewReader(body), contentType)
	return err
}

func (b ObjectStorageBridge) Download(ctx context.Context, key string) ([]byte, string, error) {
	body, object, err := b.Store.Get(ctx, key)
	if err != nil {
		return nil, "", err
	}
	defer body.Close()
	contents, err := io.ReadAll(body)
	return contents, object.ContentType, err
}

func (b ObjectStorageBridge) URL(ctx context.Context, key string) (string, error) {
	return b.Store.URL(ctx, key, 30*time.Minute)
}
