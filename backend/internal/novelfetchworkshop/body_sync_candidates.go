package novelfetchworkshop

import (
	"context"
	"sort"
	"strings"
	"time"
)

const defaultBodySyncCandidateLimit = 50

type BodySyncCandidate struct {
	BookID string `json:"bookId"`
	BodyRef
}

type BodySyncSource interface {
	GetBody(context.Context, string, string, string) (BodyRecord, error)
	ListBodySyncCandidates(context.Context, string, int) ([]BodySyncCandidate, error)
}

func normalizeBodySyncCandidateLimit(limit int) int {
	if limit <= 0 {
		return defaultBodySyncCandidateLimit
	}
	if limit > 200 {
		return 200
	}
	return limit
}

func (s *MemoryStore) ListBodySyncCandidates(_ context.Context, owner string, limit int) ([]BodySyncCandidate, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	limit = normalizeBodySyncCandidateLimit(limit)
	owner = strings.TrimSpace(owner)
	candidates := make([]BodySyncCandidate, 0, limit)
	for bookID, versions := range s.bodies[owner] {
		for _, record := range versions {
			if strings.TrimSpace(record.State) != "ready" {
				continue
			}
			candidates = append(candidates, BodySyncCandidate{BookID: bookID, BodyRef: record.BodyRef})
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		left, _ := time.Parse(time.RFC3339Nano, candidates[i].UpdatedAt)
		right, _ := time.Parse(time.RFC3339Nano, candidates[j].UpdatedAt)
		if !left.Equal(right) {
			return left.Before(right)
		}
		if candidates[i].BookID != candidates[j].BookID {
			return candidates[i].BookID < candidates[j].BookID
		}
		return candidates[i].VersionID < candidates[j].VersionID
	})
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	return candidates, nil
}
