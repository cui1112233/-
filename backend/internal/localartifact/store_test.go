package localartifact

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func minimalMP4(payload []byte) []byte {
	head := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0, 'i', 's', 'o', 'm', 'm', 'p', '4', '2'}
	return append(head, payload...)
}

func TestStoreSaveMP4WritesAtomicArtifactAndDigest(t *testing.T) {
	root := t.TempDir()
	store := NewStore(root, 1024)
	data := minimalMP4([]byte("video-bytes"))
	got, err := store.SaveMP4("lea_test123", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "lea_test123" || got.MediaType != "video/mp4" {
		t.Fatalf("unexpected artifact: %+v", got)
	}
	if got.ByteSize != int64(len(data)) {
		t.Fatalf("size=%d", got.ByteSize)
	}
	sum := sha256.Sum256(data)
	if got.SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatalf("sha=%s", got.SHA256)
	}
	saved, err := os.ReadFile(filepath.Join(root, got.StorageRef))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(saved, data) {
		t.Fatal("saved bytes differ")
	}
}

func TestStoreSaveMP4RejectsInvalidContainer(t *testing.T) {
	root := t.TempDir()
	store := NewStore(root, 1024)
	_, err := store.SaveMP4("lea_bad", bytes.NewReader([]byte("not-an-mp4")))
	if !errors.Is(err, ErrInvalidMP4) {
		t.Fatalf("err=%v", err)
	}
	entries, readErr := os.ReadDir(root)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if len(entries) != 0 {
		t.Fatalf("left files: %v", entries)
	}
}

func TestStoreSaveMP4RejectsOversizeAndCleansUp(t *testing.T) {
	root := t.TempDir()
	data := minimalMP4(bytes.Repeat([]byte{'x'}, 64))
	store := NewStore(root, int64(len(data)-1))
	_, err := store.SaveMP4("lea_large", bytes.NewReader(data))
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err=%v", err)
	}
	entries, readErr := os.ReadDir(root)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if len(entries) != 0 {
		t.Fatalf("left files: %v", entries)
	}
}
