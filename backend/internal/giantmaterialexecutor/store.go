package giantmaterialexecutor

import (
	"context"
	"time"
)

type Store interface {
	EnsureIdentityUniqueIndex(context.Context) error
	ConsolidateDuplicateExecutors(context.Context, time.Time) (int, error)
	RecentFailures(context.Context, string, time.Time) (map[string]time.Time, error)
	CreatePairing(context.Context, PairingRecord) error
	PairExecutor(context.Context, SecretHash, string, ExecutorRecord, time.Time) (ExecutorRecord, error)
	ExecutorByTokenHash(context.Context, SecretHash) (ExecutorRecord, error)
	UpdateHeartbeat(context.Context, string, HeartbeatInput, time.Time) error
	ListExecutors(context.Context, string) ([]ExecutorRecord, error)
	LatestPlatformFailure(context.Context, string, string, time.Time) (*time.Time, error)
	FindJobByKey(context.Context, string, string) (JobRecord, error)
	CreateJob(context.Context, JobRecord) error
	JobForOwner(context.Context, string, string) (JobRecord, error)
	CancelJob(context.Context, string, string, time.Time) (JobRecord, error)
	RequeueJob(context.Context, string, JobRecord, time.Time) (JobRecord, error)
	ClaimJob(context.Context, ExecutorRecord, SecretHash, time.Time, time.Time) (JobRecord, error)
	RenewJob(context.Context, string, string, SecretHash, int64, time.Time, time.Time) (JobRecord, error)
	SetProgress(context.Context, string, string, SecretHash, int64, JobState, ProgressInput, time.Time) (JobRecord, error)
	CompleteJob(context.Context, string, string, SecretHash, int64, ResultInput, time.Time) (JobRecord, error)
	FailJob(context.Context, string, string, SecretHash, int64, FailureInput, time.Time) (JobRecord, error)
	GetPreference(context.Context, string) (PreferenceRecord, error)
	SavePreference(context.Context, PreferenceRecord) error
	DeleteExecutor(context.Context, string, string, time.Time) error
}
