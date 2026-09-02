package novelfetchworkshop

import (
	"context"
	"time"
)

type LifecycleStore interface {
	Store
	MarkBodyReleasable(context.Context, string, string, string, time.Time, int) (BodyRef, error)
	CleanupBodies(context.Context, string, BodyCleanupRequest) (BodyCleanupResult, error)
}
