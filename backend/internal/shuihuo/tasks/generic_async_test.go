package tasks

import (
	"context"
	"errors"
	"testing"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
)

type genericPollerStub struct {
	result models.GenericTask
	err    error
}

func (p genericPollerStub) Poll(context.Context, models.Definition, string) (models.GenericTask, error) {
	return p.result, p.err
}

func TestWorkerKeepsGenericAsyncTextToVideoRunningWithoutPrimaryImage(t *testing.T) {
	taskRepo := &asyncWorkerTaskRepo{task: domain.Task{ID: 18, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskQueued, Provider: models.AdapterGenericHTTP, ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4), Input: `{"prompt":"镜头推进"}`}}
	worker := Worker{
		Tasks: taskRepo,
		Models: workerModelRepo{model: models.Definition{
			ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterGenericHTTP,
			PollingTemplate: `{"endpoint":"https://provider.example/tasks/{{provider_task_id}}","resultUrl":"video_url"}`,
		}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    asyncWorkerMediaRepo{}, Objects: &workerObjects{},
		Adapter: workerAdapter{response: models.Response{ProviderTaskID: "doubao-42"}},
	}
	if err := worker.Process(context.Background(), 18); err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if taskRepo.task.Status != domain.TaskRunning || taskRepo.task.ProviderTaskID != "doubao-42" || taskRepo.nextPoll.IsZero() {
		t.Fatalf("task = %#v provider=%q next=%s", taskRepo.task, taskRepo.providerID, taskRepo.nextPoll)
	}
}

func TestPollerPersistsGenericAsyncVideoResult(t *testing.T) {
	taskRepo := &pollerTaskRepo{task: domain.Task{ID: 19, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskRunning, Provider: models.AdapterGenericHTTP, ProviderTaskID: "doubao-42", ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4)}}
	poller := Poller{
		Tasks: taskRepo,
		Models: pollerModelRepo{model: models.Definition{
			ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterGenericHTTP,
			PollingTemplate: `{"endpoint":"https://provider.example/tasks/{{provider_task_id}}","resultUrl":"video_url"}`,
		}},
		Generic:        genericPollerStub{result: models.GenericTask{State: models.GenericTaskSucceeded, ResultURL: "https://cdn.example.com/result.mp4"}},
		Objects:        &workerObjects{},
		DownloadResult: func(context.Context, string) ([]byte, string, error) { return []byte("mp4"), "video/mp4", nil },
	}
	if err := poller.PollOnce(context.Background(), taskRepo.task); err != nil {
		t.Fatal(err)
	}
	if taskRepo.completed != 1 || taskRepo.task.Status != domain.TaskSucceeded {
		t.Fatalf("completed=%d status=%s", taskRepo.completed, taskRepo.task.Status)
	}
}

func TestPollerRetriesTransientGenericPollingFailure(t *testing.T) {
	taskRepo := &pollerTaskRepo{task: domain.Task{ID: 20, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskRunning, Provider: models.AdapterGenericHTTP, ProviderTaskID: "doubao-42", ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4)}}
	poller := Poller{
		Tasks: taskRepo,
		Models: pollerModelRepo{model: models.Definition{
			ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterGenericHTTP,
			PollingTemplate: `{"endpoint":"https://provider.example/tasks/{{provider_task_id}}","resultUrl":"video_url"}`,
		}},
		Generic: genericPollerStub{err: &models.GenericPollError{Transient: true, Err: errors.New("provider busy")}},
		Objects: &workerObjects{},
	}
	if err := poller.PollOnce(context.Background(), taskRepo.task); err != nil {
		t.Fatal(err)
	}
	if taskRepo.nextPollCalls != 1 || taskRepo.task.Status != domain.TaskRunning || taskRepo.failureCode != "" {
		t.Fatalf("nextPollCalls=%d status=%s failure=%q", taskRepo.nextPollCalls, taskRepo.task.Status, taskRepo.failureCode)
	}
}
