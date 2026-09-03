package localartifact

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

var (
	ErrInvalidMP4    = errors.New("invalid mp4 artifact")
	ErrTooLarge      = errors.New("artifact exceeds size limit")
	ErrInvalidID     = errors.New("invalid artifact id")
	ErrAlreadyExists = errors.New("artifact already exists")
)

var safeArtifactID = regexp.MustCompile(`^[A-Za-z0-9_-]{3,96}$`)

type Artifact struct {
	ID         string
	MediaType  string
	ByteSize   int64
	SHA256     string
	StorageRef string
}

type Store struct {
	root     string
	maxBytes int64
}

func NewStore(root string, maxBytes int64) *Store {
	if maxBytes <= 0 {
		maxBytes = 1 << 30
	}
	return &Store{root: filepath.Clean(root), maxBytes: maxBytes}
}

func (s *Store) SaveMP4(id string, src io.Reader) (artifact Artifact, err error) {
	if s == nil || !safeArtifactID.MatchString(id) || src == nil {
		return Artifact{}, ErrInvalidID
	}
	if err := os.MkdirAll(s.root, 0o750); err != nil {
		return Artifact{}, err
	}
	finalName := id + ".mp4"
	finalPath := filepath.Join(s.root, finalName)
	if _, statErr := os.Stat(finalPath); statErr == nil {
		return Artifact{}, ErrAlreadyExists
	} else if !os.IsNotExist(statErr) {
		return Artifact{}, statErr
	}

	tmp, err := os.CreateTemp(s.root, ".upload-*.tmp")
	if err != nil {
		return Artifact{}, err
	}
	tmpName := tmp.Name()
	committed := false
	defer func() {
		if !committed {
			_ = tmp.Close()
			_ = os.Remove(tmpName)
		}
	}()

	first := make([]byte, 24)
	nFirst, readErr := io.ReadFull(src, first)
	if readErr != nil {
		return Artifact{}, ErrInvalidMP4
	}
	first = first[:nFirst]
	if len(first) < 12 || string(first[4:8]) != "ftyp" {
		return Artifact{}, ErrInvalidMP4
	}
	if int64(len(first)) > s.maxBytes {
		return Artifact{}, ErrTooLarge
	}

	hash := sha256.New()
	writer := io.MultiWriter(tmp, hash)
	if _, err := writer.Write(first); err != nil {
		return Artifact{}, err
	}
	remainingLimit := s.maxBytes - int64(len(first)) + 1
	copied, err := io.Copy(writer, io.LimitReader(src, remainingLimit))
	if err != nil {
		return Artifact{}, err
	}
	total := int64(len(first)) + copied
	if total > s.maxBytes {
		return Artifact{}, ErrTooLarge
	}
	if err := tmp.Sync(); err != nil {
		return Artifact{}, err
	}
	if err := tmp.Close(); err != nil {
		return Artifact{}, err
	}
	if err := os.Rename(tmpName, finalPath); err != nil {
		return Artifact{}, fmt.Errorf("commit artifact: %w", err)
	}
	committed = true
	return Artifact{
		ID: id, MediaType: "video/mp4", ByteSize: total,
		SHA256: hex.EncodeToString(hash.Sum(nil)), StorageRef: finalName,
	}, nil
}

func (s *Store) Remove(storageRef string) error {
	if s == nil || filepath.Base(storageRef) != storageRef {
		return ErrInvalidID
	}
	err := os.Remove(filepath.Join(s.root, storageRef))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *Store) Open(storageRef string) (*os.File, error) {
	if s == nil || filepath.Base(storageRef) != storageRef {
		return nil, ErrInvalidID
	}
	return os.Open(filepath.Join(s.root, storageRef))
}
