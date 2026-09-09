package mergeworker

import (
	"context"
	"errors"
	"sync"
	"time"
)

var ErrNotFound = errors.New("merge worker job not found")

type Store interface {
	Create(context.Context, Job) (Job, error)
	Get(context.Context, string) (Job, error)
	Update(context.Context, Job) (Job, error)
}

type Queue interface {
	Enqueue(context.Context, string) error
}

type MemoryStore struct {
	mu   sync.RWMutex
	jobs map[string]Job
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{jobs: map[string]Job{}}
}

func (s *MemoryStore) Create(_ context.Context, job Job) (Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	if job.CreatedAt.IsZero() {
		job.CreatedAt = now
	}
	job.UpdatedAt = now
	job.Sources = append([]Source(nil), job.Sources...)
	s.jobs[job.ID] = job
	return job, nil
}

func (s *MemoryStore) Get(_ context.Context, id string) (Job, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	job, ok := s.jobs[id]
	if !ok {
		return Job{}, ErrNotFound
	}
	job.Sources = append([]Source(nil), job.Sources...)
	return job, nil
}

func (s *MemoryStore) Update(_ context.Context, job Job) (Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.jobs[job.ID]; !ok {
		return Job{}, ErrNotFound
	}
	job.UpdatedAt = time.Now().UTC()
	job.Sources = append([]Source(nil), job.Sources...)
	s.jobs[job.ID] = job
	return job, nil
}

type MemoryQueue struct {
	mu  sync.Mutex
	ids []string
}

func NewMemoryQueue() *MemoryQueue { return &MemoryQueue{} }

func (q *MemoryQueue) Enqueue(_ context.Context, id string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.ids = append(q.ids, id)
	return nil
}

func (q *MemoryQueue) IDs() []string {
	q.mu.Lock()
	defer q.mu.Unlock()
	return append([]string(nil), q.ids...)
}
