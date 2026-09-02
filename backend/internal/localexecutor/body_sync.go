package localexecutor

import (
	"context"
	"errors"
	"strings"
	"time"

	"qiantie/backend/internal/novelfetchworkshop"
)

var (
	ErrNoPendingBodySync    = errors.New("no pending novel body sync")
	ErrStaleBodySyncLease   = errors.New("stale novel body sync lease")
	ErrBodySyncLeaseBusy    = errors.New("novel body sync lease busy")
	ErrBodySyncAlreadyAcked = errors.New("novel body sync revision already acknowledged")
	ErrBodySyncIntegrity    = errors.New("novel body sync integrity mismatch")
)

const BodySyncLeaseTTL = 60 * time.Second

type BodySyncState string

const (
	BodySyncLeased BodySyncState = "leased"
	BodySyncAcked  BodySyncState = "acked"
)

type BodySyncLeaseCredential struct {
	Token      string `json:"leaseToken"`
	Generation int64  `json:"leaseGeneration"`
}

type BodySyncAckInput struct {
	Revision    uint64 `json:"revision"`
	ContentHash string `json:"contentHash"`
}

type BodySyncRecord struct {
	ID              string
	OwnerUsername   string
	BookID          string
	VersionID       string
	BodyRevision    uint64
	ContentHash     string
	State           BodySyncState
	LeaseExecutorID string
	LeaseTokenHash  SecretHash
	LeaseGeneration int64
	LeaseExpiresAt  *time.Time
	AckedAt         *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type BodySyncClaim struct {
	SyncID          string                         `json:"syncId"`
	Body            novelfetchworkshop.BodyRecord `json:"body"`
	LeaseToken      string                         `json:"leaseToken"`
	LeaseGeneration int64                          `json:"leaseGeneration"`
	LeaseExpiresAt  time.Time                      `json:"leaseExpiresAt"`
}

type BodySyncStore interface {
	ClaimBodySync(context.Context, ExecutorRecord, string, novelfetchworkshop.BodyRecord, SecretHash, time.Time, time.Time) (BodySyncRecord, error)
	AckBodySync(context.Context, ExecutorRecord, string, SecretHash, int64, uint64, string, time.Time) (BodySyncRecord, error)
}

type BodySyncService struct {
	executors *Service
	source    novelfetchworkshop.BodySyncSource
	store     BodySyncStore
	now       func() time.Time
}

func NewBodySyncService(executors *Service, source novelfetchworkshop.BodySyncSource, store BodySyncStore, now func() time.Time) *BodySyncService {
	if now == nil {
		now = time.Now
	}
	return &BodySyncService{executors: executors, source: source, store: store, now: now}
}

func (s *BodySyncService) Claim(ctx context.Context, executorToken string) (BodySyncClaim, error) {
	if s == nil || s.executors == nil || s.source == nil || s.store == nil {
		return BodySyncClaim{}, ErrInvalidInput
	}
	executor, err := s.executors.executorForToken(ctx, executorToken)
	if err != nil {
		return BodySyncClaim{}, err
	}
	candidates, err := s.source.ListBodySyncCandidates(ctx, executor.OwnerUsername, 50)
	if err != nil {
		return BodySyncClaim{}, err
	}
	for _, candidate := range candidates {
		body, err := s.source.GetBody(ctx, executor.OwnerUsername, candidate.BookID, candidate.VersionID)
		if err != nil {
			if errors.Is(err, novelfetchworkshop.ErrNotFound) {
				continue
			}
			return BodySyncClaim{}, err
		}
		if strings.TrimSpace(body.State) != "ready" {
			continue
		}
		leaseToken, err := randomToken()
		if err != nil {
			return BodySyncClaim{}, err
		}
		syncID, err := randomID("lbs_", 12)
		if err != nil {
			return BodySyncClaim{}, err
		}
		now := s.now().UTC()
		expires := now.Add(BodySyncLeaseTTL)
		record, err := s.store.ClaimBodySync(ctx, executor, syncID, body, hashSecret(leaseToken), expires, now)
		if errors.Is(err, ErrBodySyncAlreadyAcked) || errors.Is(err, ErrBodySyncLeaseBusy) {
			continue
		}
		if err != nil {
			return BodySyncClaim{}, err
		}
		if record.LeaseExpiresAt == nil {
			return BodySyncClaim{}, ErrStaleBodySyncLease
		}
		return BodySyncClaim{
			SyncID: record.ID, Body: body, LeaseToken: leaseToken,
			LeaseGeneration: record.LeaseGeneration, LeaseExpiresAt: *record.LeaseExpiresAt,
		}, nil
	}
	return BodySyncClaim{}, ErrNoPendingBodySync
}

func (s *BodySyncService) Ack(ctx context.Context, executorToken, syncID string, lease BodySyncLeaseCredential, input BodySyncAckInput) error {
	if s == nil || s.executors == nil || s.store == nil {
		return ErrInvalidInput
	}
	executor, err := s.executors.executorForToken(ctx, executorToken)
	if err != nil {
		return err
	}
	if strings.TrimSpace(syncID) == "" || strings.TrimSpace(lease.Token) == "" || lease.Generation < 1 {
		return ErrStaleBodySyncLease
	}
	if input.Revision < 1 || strings.TrimSpace(input.ContentHash) == "" {
		return ErrBodySyncIntegrity
	}
	_, err = s.store.AckBodySync(ctx, executor, strings.TrimSpace(syncID), hashSecret(lease.Token), lease.Generation, input.Revision, strings.TrimSpace(input.ContentHash), s.now().UTC())
	return err
}
