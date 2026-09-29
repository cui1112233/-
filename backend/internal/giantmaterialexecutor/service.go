package giantmaterialexecutor

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/url"
	"strings"
	"time"
)

type Service struct {
	store Store
	now   func() time.Time
}

func NewService(store Store, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{store: store, now: now}
}

func (s *Service) CreatePairing(ctx context.Context, owner, platform string) (PairingSecret, error) {
	owner = strings.TrimSpace(owner)
	platform = strings.ToLower(strings.TrimSpace(platform))
	if owner == "" {
		return PairingSecret{}, ErrInvalidInput
	}
	if platform != PlatformGiantMaterial {
		return PairingSecret{}, ErrInvalidPlatform
	}
	code, err := randomCode()
	if err != nil {
		return PairingSecret{}, err
	}
	now := s.now().UTC()
	expires := now.Add(PairingTTL)
	if err := s.store.CreatePairing(ctx, PairingRecord{ID: randomID("gme_pair_"), OwnerUsername: owner, Platform: platform, CodeHash: hashPairingCode(code), ExpiresAt: expires, CreatedAt: now}); err != nil {
		return PairingSecret{}, err
	}
	return PairingSecret{Code: code, ExpiresAt: expires}, nil
}

func (s *Service) Pair(ctx context.Context, input PairInput) (PairResult, error) {
	if strings.ToLower(strings.TrimSpace(input.Platform)) != PlatformGiantMaterial || normalizePairingCode(input.Code) == "" {
		if strings.ToLower(strings.TrimSpace(input.Platform)) != PlatformGiantMaterial {
			return PairResult{}, ErrInvalidPlatform
		}
		return PairResult{}, ErrPairingInvalid
	}
	if err := validateDeviceFields(input.DeviceName, input.OS, input.Version); err != nil {
		return PairResult{}, err
	}
	token, err := randomToken()
	if err != nil {
		return PairResult{}, err
	}
	executor := ExecutorRecord{ID: randomID("gme_exec_"), Platform: PlatformGiantMaterial, TokenHash: hashSecret(token), DeviceName: strings.TrimSpace(input.DeviceName), OS: strings.TrimSpace(input.OS), Version: strings.TrimSpace(input.Version), CreatedAt: s.now().UTC(), UpdatedAt: s.now().UTC()}
	created, err := s.store.PairExecutor(ctx, hashPairingCode(input.Code), PlatformGiantMaterial, executor, s.now().UTC())
	if err != nil {
		return PairResult{}, err
	}
	return PairResult{ExecutorID: created.ID, Token: token, HeartbeatIntervalSeconds: HeartbeatIntervalSeconds}, nil
}

func (s *Service) Heartbeat(ctx context.Context, token string, input HeartbeatInput) error {
	executor, err := s.executorForToken(ctx, token)
	if err != nil {
		return err
	}
	if err := validateDeviceFields(input.DeviceName, input.OS, input.Version); err != nil {
		return err
	}
	return s.store.UpdateHeartbeat(ctx, executor.ID, input, s.now().UTC())
}

func (s *Service) ListExecutors(ctx context.Context, owner string) ([]ExecutorView, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return nil, ErrInvalidInput
	}
	records, err := s.store.ListExecutors(ctx, owner)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	views := make([]ExecutorView, 0, len(records))
	for _, record := range records {
		views = append(views, ExecutorView{ID: record.ID, Name: record.DeviceName, Platform: record.Platform, OS: record.OS, Version: record.Version, Online: record.LastSeenAt != nil && !record.LastSeenAt.Before(now.Add(-OnlineThreshold)), LastSeenAt: record.LastSeenAt})
	}
	return views, nil
}

func (s *Service) CreateJob(ctx context.Context, owner string, input CreateJobInput) (JobView, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" || strings.TrimSpace(input.MaterialID) == "" || strings.TrimSpace(input.PlatformBookID) == "" || strings.TrimSpace(input.Title) == "" || strings.TrimSpace(input.ModelVersion) == "" {
		return JobView{}, ErrInvalidInput
	}
	if strings.ToLower(strings.TrimSpace(input.Platform)) != PlatformGiantMaterial {
		return JobView{}, ErrInvalidPlatform
	}
	if err := validateVideoURL(input.VideoURL); err != nil {
		return JobView{}, err
	}
	if input.VideoExpiresAt != nil && !input.VideoExpiresAt.After(s.now().UTC()) {
		return JobView{}, ErrInvalidInput
	}
	record := JobRecord{ID: randomID("gme_job_"), OwnerUsername: owner, Platform: PlatformGiantMaterial, MaterialID: strings.TrimSpace(input.MaterialID), PlatformBookID: strings.TrimSpace(input.PlatformBookID), Title: bounded(input.Title, 191), VideoURL: strings.TrimSpace(input.VideoURL), VideoExpiresAt: input.VideoExpiresAt, ModelVersion: bounded(input.ModelVersion, 64), ContentRangeLines: bounded(input.ContentRangeLines, 64), State: JobQueued, CreatedAt: s.now().UTC(), UpdatedAt: s.now().UTC()}
	key := jobKey(record)
	if existing, err := s.store.FindJobByKey(ctx, owner, key); err == nil {
		return jobView(existing), nil
	} else if err != ErrJobNotFound {
		return JobView{}, err
	}
	if err := s.store.CreateJob(ctx, record); err != nil {
		if err == ErrJobConflict {
			if existing, lookupErr := s.store.FindJobByKey(ctx, owner, key); lookupErr == nil {
				return jobView(existing), nil
			}
		}
		return JobView{}, err
	}
	return jobView(record), nil
}

func (s *Service) GetJob(ctx context.Context, owner, id string) (JobView, error) {
	record, err := s.store.JobForOwner(ctx, strings.TrimSpace(owner), strings.TrimSpace(id))
	if err != nil {
		return JobView{}, err
	}
	return jobView(record), nil
}

func (s *Service) CancelJob(ctx context.Context, owner, id string) (JobView, error) {
	record, err := s.store.CancelJob(ctx, strings.TrimSpace(owner), strings.TrimSpace(id), s.now().UTC())
	if err != nil {
		return JobView{}, err
	}
	return jobView(record), nil
}

func (s *Service) Claim(ctx context.Context, token string) (ClaimResult, error) {
	executor, err := s.executorForToken(ctx, token)
	if err != nil {
		return ClaimResult{}, err
	}
	leaseToken, err := randomToken()
	if err != nil {
		return ClaimResult{}, err
	}
	now := s.now().UTC()
	expires := now.Add(JobLeaseTTL)
	record, err := s.store.ClaimJob(ctx, executor, hashSecret(leaseToken), expires, now)
	if err != nil {
		return ClaimResult{}, err
	}
	return ClaimResult{Job: jobView(record), LeaseToken: leaseToken, LeaseGeneration: record.LeaseGeneration, LeaseExpiresAt: expires}, nil
}

func (s *Service) Renew(ctx context.Context, token, jobID string, lease LeaseCredential) (LeaseView, error) {
	executor, err := s.executorForToken(ctx, token)
	if err != nil {
		return LeaseView{}, err
	}
	if strings.TrimSpace(lease.Token) == "" || lease.Generation < 1 {
		return LeaseView{}, ErrStaleLease
	}
	expires := s.now().UTC().Add(JobLeaseTTL)
	record, err := s.store.RenewJob(ctx, executor.ID, strings.TrimSpace(jobID), hashSecret(lease.Token), lease.Generation, expires, s.now().UTC())
	if err != nil {
		return LeaseView{}, err
	}
	return LeaseView{LeaseGeneration: record.LeaseGeneration, LeaseExpiresAt: expires}, nil
}

func (s *Service) Progress(ctx context.Context, token, jobID string, lease LeaseCredential, next JobState, progress ProgressInput) error {
	executor, err := s.executorForToken(ctx, token)
	if err != nil {
		return err
	}
	if !validProgress(next) || progress.Completed < 0 || progress.Total < 0 || progress.Completed > progress.Total || progress.Percent < 0 || progress.Percent > 100 {
		return ErrInvalidInput
	}
	_, err = s.store.SetProgress(ctx, executor.ID, strings.TrimSpace(jobID), hashSecret(lease.Token), lease.Generation, next, progress, s.now().UTC())
	return err
}

func (s *Service) Complete(ctx context.Context, token, jobID string, lease LeaseCredential, input ResultInput) (JobView, error) {
	executor, err := s.executorForToken(ctx, token)
	if err != nil {
		return JobView{}, err
	}
	if strings.TrimSpace(input.Text) == "" {
		return JobView{}, ErrInvalidInput
	}
	if len([]byte(input.Text)) > MaxResultBytes {
		return JobView{}, ErrResultTooLarge
	}
	record, err := s.store.CompleteJob(ctx, executor.ID, strings.TrimSpace(jobID), hashSecret(lease.Token), lease.Generation, input, s.now().UTC())
	if err != nil {
		return JobView{}, err
	}
	return jobView(record), nil
}

func (s *Service) Fail(ctx context.Context, token, jobID string, lease LeaseCredential, input FailureInput) error {
	executor, err := s.executorForToken(ctx, token)
	if err != nil {
		return err
	}
	_, err = s.store.FailJob(ctx, executor.ID, strings.TrimSpace(jobID), hashSecret(lease.Token), lease.Generation, FailureInput{Code: bounded(input.Code, 96), Message: bounded(input.Message, 512)}, s.now().UTC())
	return err
}

func (s *Service) executorForToken(ctx context.Context, token string) (ExecutorRecord, error) {
	if strings.TrimSpace(token) == "" {
		return ExecutorRecord{}, ErrExecutorUnauthorized
	}
	record, err := s.store.ExecutorByTokenHash(ctx, hashSecret(strings.TrimSpace(token)))
	if err != nil {
		return ExecutorRecord{}, ErrExecutorUnauthorized
	}
	return record, nil
}

func jobView(record JobRecord) JobView {
	return JobView{ID: record.ID, Platform: record.Platform, MaterialID: record.MaterialID, PlatformBookID: record.PlatformBookID, Title: record.Title, ModelVersion: record.ModelVersion, ContentRangeLines: record.ContentRangeLines, State: record.State, CancelRequested: record.CancelRequested, LeaseExecutorID: record.LeaseExecutorID, LeaseGeneration: record.LeaseGeneration, LeaseExpiresAt: record.LeaseExpiresAt, Progress: record.Progress, Result: record.Result, ErrorCode: record.ErrorCode, ErrorMessage: record.ErrorMessage, CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt}
}

func normalizePairingCode(code string) string {
	return strings.ToUpper(strings.NewReplacer("-", "", " ", "", "_", "").Replace(strings.TrimSpace(code)))
}

func validateDeviceFields(name, osName, version string) error {
	if len(strings.TrimSpace(name)) > 191 || len(strings.TrimSpace(osName)) > 32 || len(strings.TrimSpace(version)) > 64 {
		return ErrInvalidInput
	}
	return nil
}

func validateVideoURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Host != "material.hnqingyuwen.top" || parsed.Path == "" {
		return ErrInvalidInput
	}
	return nil
}

func validProgress(state JobState) bool {
	switch state {
	case JobRunning, JobCleaning, JobUploading:
		return true
	default:
		return false
	}
}

func validJobTransition(from, to JobState) error {
	if from == to {
		return nil
	}
	switch {
	case from == JobLeased && to == JobRunning:
	case from == JobRunning && to == JobCleaning:
	case from == JobCleaning && to == JobUploading:
	default:
		return ErrInvalidJobState
	}
	return nil
}

const pairingAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func randomCode() (string, error) {
	bytes := make([]byte, 10)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	for i := range bytes {
		bytes[i] = pairingAlphabet[int(bytes[i])%len(pairingAlphabet)]
	}
	return string(bytes[:5]) + "-" + string(bytes[5:]), nil
}

func randomToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func randomID(prefix string) string {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("%s%x", prefix, time.Now().UnixNano())
	}
	return prefix + base64.RawURLEncoding.EncodeToString(bytes)
}
