package storage

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
	"time"
)

func TestObjectKeyAlwaysIncludesOwnerAndProject(t *testing.T) {
	key, err := ObjectKey(7, 9, "images", "shot.png")
	if err != nil {
		t.Fatalf("ObjectKey() error = %v", err)
	}
	if want := "shuihuo-production/7/9/images/shot.png"; key != want {
		t.Fatalf("ObjectKey() = %q, want %q", key, want)
	}
}

func TestObjectKeyRejectsUnsafeValues(t *testing.T) {
	tests := []struct {
		name      string
		userID    int64
		projectID int64
		category  string
		filename  string
	}{
		{name: "zero user", projectID: 1, category: "images", filename: "shot.png"},
		{name: "zero project", userID: 1, category: "images", filename: "shot.png"},
		{name: "unknown category", userID: 1, projectID: 1, category: "other", filename: "shot.png"},
		{name: "parent path", userID: 1, projectID: 1, category: "images", filename: "../shot.png"},
		{name: "nested path", userID: 1, projectID: 1, category: "images", filename: "folder/shot.png"},
		{name: "empty filename", userID: 1, projectID: 1, category: "images", filename: ""},
		{name: "leading whitespace", userID: 1, projectID: 1, category: "images", filename: " story.png"},
		{name: "trailing whitespace", userID: 1, projectID: 1, category: "images", filename: "story.png "},
		{name: "tab", userID: 1, projectID: 1, category: "images", filename: "\tstory.png"},
		{name: "control character", userID: 1, projectID: 1, category: "images", filename: "story\x7f.png"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ObjectKey(tt.userID, tt.projectID, tt.category, tt.filename); err == nil {
				t.Fatal("ObjectKey() accepted unsafe value")
			}
		})
	}
}

func TestValidObjectKeyRejectsValuesBeyondIndexedStorageLimit(t *testing.T) {
	key := "shuihuo-production/1/1/source/" + strings.Repeat("a", maxObjectKeyLength)
	if ValidObjectKey(key) {
		t.Fatal("ValidObjectKey() accepted a value longer than the durable queue index permits")
	}
}

func TestLocalStorageRejectsTraversal(t *testing.T) {
	store := NewLocal(t.TempDir(), "http://localhost:4000")
	if _, err := store.Put(context.Background(), "../../etc/passwd", bytes.NewReader(nil), "text/plain"); err == nil {
		t.Fatal("Put() accepted traversal key")
	}
	if _, err := store.Put(context.Background(), "shuihuo-production/../../images/shot.png", bytes.NewReader(nil), "text/plain"); err == nil {
		t.Fatal("Put() accepted traversal through owner and project segments")
	}
}

func TestLocalStorageRoundTripAndAuthenticatedURL(t *testing.T) {
	store := NewLocal(t.TempDir(), "http://localhost:4000/")
	key, err := ObjectKey(7, 9, "images", "shot.png")
	if err != nil {
		t.Fatal(err)
	}
	written, err := store.Put(context.Background(), key, strings.NewReader("image-data"), "image/png")
	if err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	if written.Size != int64(len("image-data")) || written.Key != key {
		t.Fatalf("Put() object = %#v", written)
	}

	body, got, err := store.Get(context.Background(), key)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	defer body.Close()
	contents, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "image-data" || got.Key != key {
		t.Fatalf("Get() contents=%q object=%#v", contents, got)
	}

	url, err := store.URL(context.Background(), key, time.Minute)
	if err != nil {
		t.Fatalf("URL() error = %v", err)
	}
	if !strings.HasPrefix(url, "http://localhost:4000/api/shuihuo-production/objects?") || !strings.Contains(url, "key=") {
		t.Fatalf("URL() = %q", url)
	}

	if err := store.Delete(context.Background(), key); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if _, _, err := store.Get(context.Background(), key); err == nil {
		t.Fatal("Get() succeeded after Delete()")
	}
}
