package store

import "errors"

// ErrTaskSegmentUnavailable is returned when a task points to a storyboard
// segment that is no longer available. HTTP handlers use this sentinel to
// return a refresh/retry conflict instead of a generic server error.
var ErrTaskSegmentUnavailable = errors.New("task segment is unavailable")
