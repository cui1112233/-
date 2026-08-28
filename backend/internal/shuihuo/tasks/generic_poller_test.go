package tasks

import (
	"context"
	"testing"
	"time"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
)

type genericPollProvider struct{ result models.GenericPollResult }

func (p genericPollProvider) Poll(context.Context, models.Definition, string) (models.GenericPollResult, error) {
	return p.result, nil
}

func TestWorkerKeepsGenericAsyncTextVideoRunning(t *testing.T) {
	taskRepo := &asyncWorkerTaskRepo{task: domain.Task{
		ID: 18, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskQueued,
		Provider: models.AdapterGenericHTTP, ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4),
		Input: `{"prompt":"镜头推进","duration":13,"aspectRatio":"9:16"}`,
	}}
	worker := Worker{
		Tasks: taskRepo,
		Models: workerModelRepo{model: models.Definition{
			ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterGenericHTTP,
			RequestTemplate: `{"body":{"prompt":"{{prompt}}"}}`,
			PollingTemplate: `{"method":"GET","url":"https://provider.example/tasks/{{provider_task_id}}","statusPath":"data.status","resultUrlPath":"data.url","succeeded":["completed"],"failed":["failed"]}`,
		}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    &memoryMediaRepo{},
		Objects:  &workerObjects{},
		Adapter:  workerAdapter{response: models.Response{ProviderTaskID: "generic-42"}},
	}
	if err := worker.Process(context.Background(), 18); err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if taskRepo.task.Status != domain.TaskRunning || taskRepo.task.ProviderTaskID != "generic-42" || taskRepo.nextPoll.IsZero() {
		t.Fatalf("task = %#v next=%s", taskRepo.task, taskRepo.nextPoll)
	}
}

func TestGenericPollerPersistsCompletedVideo(t *testing.T) {
	taskRepo := &pollerTaskRepo{task: domain.Task{
		ID: 19, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskRunning,
		Provider: models.AdapterGenericHTTP, ProviderTaskID: "generic-42", ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4),
	}}
	poller := GenericPoller{
		Tasks: taskRepo,
		Models: pollerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterGenericHTTP}},
		Provider: genericPollProvider{result: models.GenericPollResult{State: models.GenericPollSucceeded, ResultURL: "https://cdn.example.com/final.mp4"}},
		Objects: &workerObjects{},
		DownloadResult: func(context.Context, string) ([]byte, string, error) { return []byte("mp4"), "video/mp4", nil },
		Now: func() time.Time { return time.Date(2026, time.August, 25, 12, 0, 0, 0, time.UTC) },
	}
	if err := poller.PollOnce(context.Background(), taskRepo.task); err != nil {
		t.Fatalf("PollOnce() error = %v", err)
	}
	if taskRepo.completed != 1 || taskRepo.task.Status != domain.TaskSucceeded {
		t.Fatalf("completed=%d status=%s", taskRepo.completed, taskRepo.task.Status)
	}
}
