package novelfetchworkshop

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
)

var ErrNotFound = errors.New("novel fetch workshop record not found")

type Document struct {
	BookID      string         `json:"bookId"`
	Meta        map[string]any `json:"meta"`
	Original    string         `json:"original"`
	OriginalRaw string         `json:"originalRaw"`
	Versions    map[string]any `json:"versions"`
	Logs        []any          `json:"logs"`
	UpdatedAt   string         `json:"updatedAt,omitempty"`
}

type DeleteResult struct {
	Requested int            `json:"requested"`
	Deleted   int            `json:"deleted"`
	Results   []DeleteRecord `json:"results"`
}

type DeleteRecord struct {
	BookID  string `json:"bookId"`
	Deleted bool   `json:"deleted"`
}

type Store interface {
	GetDocument(context.Context, string, string) (Document, error)
	PutDocument(context.Context, string, Document) error
	ListDocuments(context.Context, string) ([]Document, error)
	DeleteDocuments(context.Context, string, []string) (DeleteResult, error)
	GetConfig(context.Context, string) (map[string]any, error)
	PutConfig(context.Context, string, map[string]any) error
}

func normalizeDocument(document Document) Document {
	document.BookID = strings.TrimSpace(document.BookID)
	if document.Meta == nil {
		document.Meta = map[string]any{}
	}
	if document.Versions == nil {
		document.Versions = map[string]any{}
	}
	if document.Logs == nil {
		document.Logs = []any{}
	}
	return document
}

func cloneDocument(document Document) Document {
	raw, _ := json.Marshal(document)
	var cloned Document
	_ = json.Unmarshal(raw, &cloned)
	return normalizeDocument(cloned)
}

func cloneMap(value map[string]any) map[string]any {
	raw, _ := json.Marshal(value)
	var cloned map[string]any
	_ = json.Unmarshal(raw, &cloned)
	if cloned == nil {
		cloned = map[string]any{}
	}
	return cloned
}

type MemoryStore struct {
	mu      sync.RWMutex
	docs    map[string]map[string]Document
	configs map[string]map[string]any
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{docs: map[string]map[string]Document{}, configs: map[string]map[string]any{}}
}

func (s *MemoryStore) GetDocument(_ context.Context, owner, bookID string) (Document, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	document, ok := s.docs[owner][bookID]
	if !ok {
		return Document{}, ErrNotFound
	}
	return cloneDocument(document), nil
}

func (s *MemoryStore) PutDocument(_ context.Context, owner string, document Document) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	document = normalizeDocument(document)
	document.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if s.docs[owner] == nil {
		s.docs[owner] = map[string]Document{}
	}
	s.docs[owner][document.BookID] = cloneDocument(document)
	return nil
}

func (s *MemoryStore) ListDocuments(_ context.Context, owner string) ([]Document, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]Document, 0, len(s.docs[owner]))
	for _, document := range s.docs[owner] {
		result = append(result, cloneDocument(document))
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].UpdatedAt == result[j].UpdatedAt {
			return result[i].BookID < result[j].BookID
		}
		return result[i].UpdatedAt > result[j].UpdatedAt
	})
	return result, nil
}

func (s *MemoryStore) DeleteDocuments(_ context.Context, owner string, ids []string) (DeleteResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := DeleteResult{Requested: len(ids), Results: make([]DeleteRecord, 0, len(ids))}
	for _, id := range ids {
		_, exists := s.docs[owner][id]
		if exists {
			delete(s.docs[owner], id)
			result.Deleted++
		}
		result.Results = append(result.Results, DeleteRecord{BookID: id, Deleted: exists})
	}
	return result, nil
}

func (s *MemoryStore) GetConfig(_ context.Context, owner string) (map[string]any, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneMap(s.configs[owner]), nil
}

func (s *MemoryStore) PutConfig(_ context.Context, owner string, settings map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.configs[owner] = cloneMap(settings)
	return nil
}
