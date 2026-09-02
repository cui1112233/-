package localexecutor

import (
	"context"
	"time"
)

func (s *MemoryStore) CreateArtifact(_ context.Context, executorID, jobID string, leaseHash SecretHash, generation int64, input ArtifactRecord, now time.Time) (ArtifactRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	job, ok := s.jobs[jobID]
	if !ok {
		return ArtifactRecord{}, ErrJobNotFound
	}
	if err := checkLease(job, executorID, leaseHash, generation, now); err != nil {
		return ArtifactRecord{}, err
	}
	if !isAccepted(job) || job.State != JobUploading {
		return ArtifactRecord{}, ErrInvalidJobState
	}
	if existingID, ok := s.jobArtifacts[jobID]; ok {
		existing := s.artifacts[existingID]
		if sameArtifactContent(existing, input) {
			return existing, nil
		}
		return ArtifactRecord{}, ErrArtifactConflict
	}
	if _, exists := s.artifacts[input.ID]; exists {
		return ArtifactRecord{}, ErrArtifactConflict
	}

	input.JobID = jobID
	input.OwnerUsername = job.OwnerUsername
	input.CreatedAt = now
	s.artifacts[input.ID] = input
	s.jobArtifacts[jobID] = input.ID
	return input, nil
}

func (s *MemoryStore) ArtifactForOwner(_ context.Context, owner, id string) (ArtifactRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.artifacts[id]
	if !ok || record.OwnerUsername != owner {
		return ArtifactRecord{}, ErrArtifactNotFound
	}
	return record, nil
}

func (s *MemoryStore) ArtifactForJob(_ context.Context, jobID string) (ArtifactRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	artifactID, ok := s.jobArtifacts[jobID]
	if !ok {
		return ArtifactRecord{}, ErrArtifactNotFound
	}
	record, ok := s.artifacts[artifactID]
	if !ok {
		return ArtifactRecord{}, ErrArtifactNotFound
	}
	return record, nil
}

func sameArtifactContent(left, right ArtifactRecord) bool {
	return left.MediaType == right.MediaType && left.ByteSize == right.ByteSize && left.SHA256 == right.SHA256
}
