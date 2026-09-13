package localartifact

import (
	"bytes"
	"os"
	"testing"
)

func TestSaveImageStoresValidatedPNG(t *testing.T) {
	store := NewStore(t.TempDir(), 1024)
	payload := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 24)...)

	artifact, err := store.SaveImage("asset-image_1", "image/png", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("SaveImage() error = %v", err)
	}
	if artifact.MediaType != "image/png" || artifact.StorageRef != "asset-image_1.png" || artifact.ByteSize != int64(len(payload)) {
		t.Fatalf("artifact = %+v", artifact)
	}
	stored, err := os.ReadFile(storePath(store, artifact.StorageRef))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stored, payload) {
		t.Fatalf("stored image differs")
	}
}

func TestSaveImageRejectsMismatchedMediaType(t *testing.T) {
	store := NewStore(t.TempDir(), 1024)
	payload := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 24)...)
	if _, err := store.SaveImage("asset-image_2", "image/jpeg", bytes.NewReader(payload)); err != ErrInvalidImage {
		t.Fatalf("SaveImage() error = %v, want %v", err, ErrInvalidImage)
	}
}

func storePath(store *Store, storageRef string) string { return store.root + "/" + storageRef }
