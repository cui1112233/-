package localexecutor

import (
	"context"
	"time"
)

func (s *MemoryStore) CreateJob(_ context.Context, record JobRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := record.OwnerUsername + "\x00" + record.SourceTaskID
	if _, exists := s.sourceJobs[key]; exists {
		return ErrJobConflict
	}
	s.jobs[record.ID] = record
	s.sourceJobs[key] = record.ID
	return nil
}

func (s *MemoryStore) JobForOwner(_ context.Context, owner, id string) (JobRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.jobs[id]
	if !ok || record.OwnerUsername != owner {
		return JobRecord{}, ErrJobNotFound
	}
	return record, nil
}

func (s *MemoryStore) CancelJob(_ context.Context, owner, id string, now time.Time) (JobRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.jobs[id]
	if !ok || record.OwnerUsername != owner {
		return JobRecord{}, ErrJobNotFound
	}
	if record.State == JobSucceeded || record.State == JobFailed || record.State == JobCancelled {
		return record, nil
	}
	record.CancelRequested = true
	record.State = JobCancelled
	record.UpdatedAt = now
	s.jobs[id] = record
	return record, nil
}

func (s *MemoryStore) ClaimJob(_ context.Context, executor ExecutorRecord, leaseHash SecretHash, expires, now time.Time) (JobRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var picked *JobRecord
	for _, record := range s.jobs {
		if record.OwnerUsername != executor.OwnerUsername || record.Platform != executor.Platform || record.CancelRequested || record.State == JobCancelled || isAccepted(record) {
			continue
		}
		claimable := record.State == JobQueued || (record.LeaseExpiresAt != nil && !record.LeaseExpiresAt.After(now) && record.State != JobSucceeded && record.State != JobFailed)
		if !claimable {
			continue
		}
		candidate := record
		if picked == nil || candidate.CreatedAt.Before(picked.CreatedAt) || (candidate.CreatedAt.Equal(picked.CreatedAt) && candidate.ID < picked.ID) {
			picked = &candidate
		}
	}
	if picked == nil {
		return JobRecord{}, ErrNoClaimableJob
	}
	record := *picked
	record.State = JobLeased
	record.LeaseExecutorID = executor.ID
	record.LeaseTokenHash = leaseHash
	record.LeaseGeneration++
	record.LeaseExpiresAt = &expires
	record.UpdatedAt = now
	s.jobs[record.ID] = record
	return record, nil
}

func (s *MemoryStore) RenewJob(_ context.Context, executorID, jobID string, leaseHash SecretHash, generation int64, expires, now time.Time) (JobRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.jobs[jobID]
	if !ok {
		return JobRecord{}, ErrJobNotFound
	}
	if err := checkLease(record, executorID, leaseHash, generation, now); err != nil {
		return JobRecord{}, err
	}
	record.LeaseExpiresAt = &expires
	record.UpdatedAt = now
	s.jobs[jobID] = record
	return record, nil
}

func (s *MemoryStore) SetJobState(_ context.Context, executorID, jobID string, leaseHash SecretHash, generation int64, next JobState, now time.Time) (JobRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.jobs[jobID]
	if !ok {
		return JobRecord{}, ErrJobNotFound
	}
	if err := checkLease(record, executorID, leaseHash, generation, now); err != nil {
		return JobRecord{}, err
	}
	if err := validateTransition(record.State, next, isAccepted(record)); err != nil {
		return JobRecord{}, err
	}
	record.State = next
	record.UpdatedAt = now
	s.jobs[jobID] = record
	return record, nil
}

func (s *MemoryStore) AcceptJob(_ context.Context, executorID, jobID string, leaseHash SecretHash, generation int64, accountID, submissionID string, now time.Time) (JobRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.jobs[jobID]
	if !ok {
		return JobRecord{}, ErrJobNotFound
	}
	if err := checkLease(record, executorID, leaseHash, generation, now); err != nil {
		return JobRecord{}, err
	}
	if isAccepted(record) {
		if record.AcceptedAccountID == accountID && record.SubmissionID == submissionID {
			return record, nil
		}
		return JobRecord{}, ErrJobConflict
	}
	if record.State != JobSubmitting && record.State != JobAcceptanceUnknown {
		return JobRecord{}, ErrInvalidJobState
	}
	record.State = JobAccepted
	record.AcceptedAt = &now
	record.AcceptedAccountID = accountID
	record.SubmissionID = submissionID
	record.UpdatedAt = now
	s.jobs[jobID] = record
	return record, nil
}

func (s *MemoryStore) ReleaseJob(_ context.Context, executorID, jobID string, leaseHash SecretHash, generation int64, reason string, now time.Time) (JobRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.jobs[jobID]
	if !ok {
		return JobRecord{}, ErrJobNotFound
	}
	if err := checkLease(record, executorID, leaseHash, generation, now); err != nil {
		return JobRecord{}, err
	}
	if isAccepted(record) {
		return JobRecord{}, ErrAcceptedJobPinned
	}
	record.State = JobQueued
	record.LeaseExecutorID = ""
	record.LeaseTokenHash = SecretHash{}
	record.LeaseExpiresAt = nil
	record.ErrorMessage = bounded(reason, 512)
	record.UpdatedAt = now
	s.jobs[jobID] = record
	return record, nil
}

func (s *MemoryStore) FailJob(_ context.Context, executorID, jobID string, leaseHash SecretHash, generation int64, code, message string, now time.Time) (JobRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.jobs[jobID]
	if !ok {
		return JobRecord{}, ErrJobNotFound
	}
	if err := checkLease(record, executorID, leaseHash, generation, now); err != nil {
		return JobRecord{}, err
	}
	record.State = JobFailed
	record.ErrorCode = bounded(code, 96)
	record.ErrorMessage = bounded(message, 512)
	record.UpdatedAt = now
	s.jobs[jobID] = record
	return record, nil
}

func (s *MemoryStore) CompleteJob(_ context.Context, executorID, jobID string, leaseHash SecretHash, generation int64, artifactID string, now time.Time) (JobRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.jobs[jobID]
	if !ok {
		return JobRecord{}, ErrJobNotFound
	}
	if err := checkLease(record, executorID, leaseHash, generation, now); err != nil {
		return JobRecord{}, err
	}
	if !isAccepted(record) {
		return JobRecord{}, ErrInvalidJobState
	}
	record.State = JobSucceeded
	record.ArtifactID = artifactID
	record.UpdatedAt = now
	s.jobs[jobID] = record
	return record, nil
}
