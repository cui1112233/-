package providers

import (
	"context"

	"qiantie/backend/internal/shuihuo/models"
)

type AsyncVideoState string

const (
	AsyncVideoRunning   AsyncVideoState = "running"
	AsyncVideoSucceeded AsyncVideoState = "succeeded"
	AsyncVideoFailed    AsyncVideoState = "failed"
)

type AsyncVideoTask struct {
	ID        string
	State     AsyncVideoState
	ResultURL string
	Message   string
}

type AsyncVideoProvider interface {
	models.Adapter
	Poll(context.Context, models.Definition, int64, string) (AsyncVideoTask, error)
}
