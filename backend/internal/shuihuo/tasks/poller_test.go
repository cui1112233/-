package tasks

import (
	"context"
	"errors"
	"testing"
	"time"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	"qiantie/backend/internal/shuihuo/providers"
)

type asyncWorkerTaskRepo struct {
	task       domain.Task
	providerID string
	nextPoll   time.Time
}

type asyncWorkerMediaRepo struct{ primary domain.Media }

func (r asyncWorkerMediaRepo) PrimaryImage(context.Context, int64, int64) (domain.Media, error) {
	return r.primary, nil
}
func (r asyncWorkerMediaRepo) CreateGenerated(context.Context, domain.Media) (domain.Media, error) {
	return domain.Media{}, errors.New("not implemented")
}

func (r *asyncWorkerTaskRepo) GetForWorker(context.Context, int64) (domain.Task, error) {
	return r.task, nil
}
func (r *asyncWorkerTaskRepo) TransitionForWorker(_ context.Context, _ int64, _, next domain.TaskStatus, _ string) error {
	r.task.Status = next
	return nil
}
func (r *asyncWorkerTaskRepo) SetFailure(_ context.Context, _ int64, code, message string) error {
	r.task.ErrorCode, r.task.ErrorMessage = code, message
	return nil
}
func (r *asyncWorkerTaskRepo) SetOutput(context.Context, int64, string) error { return nil }
func (r *asyncWorkerTaskRepo) SetProviderTask(_ context.Context, _ int64, providerTaskID string, nextPollAt time.Time) error {
	r.providerID, r.task.ProviderTaskID, r.nextPoll = providerTaskID, providerTaskID, nextPollAt
	return nil
}

func TestWorkerKeepsAsyncVideoRunning(t *testing.T) {
	taskRepo := &asyncWorkerTaskRepo{task: domain.Task{ID: 8, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskQueued, Provider: models.AdapterViduImageToVideo, ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4), Input: `{"prompt":"镜头推进"}`}}
	worker := Worker{
		Tasks:    taskRepo,
		Models:   workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterViduImageToVideo}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    asyncWorkerMediaRepo{primary: domain.Media{ObjectKey: "shuihuo-production/17/3/images/main.png", IsPrimary: true}}, Objects: &workerObjects{},
		Adapter: workerAdapter{response: models.Response{ProviderTaskID: "vidu-42"}},
	}
	if err := worker.Process(context.Background(), 8); err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if taskRepo.task.Status != domain.TaskRunning || taskRepo.task.ProviderTaskID != "vidu-42" || taskRepo.nextPoll.IsZero() {
		t.Fatalf("task = %#v provider=%q next=%s", taskRepo.task, taskRepo.providerID, taskRepo.nextPoll)
	}
}

type pollerTaskRepo struct {
	task          domain.Task
	completed     int
	failureCode   string
	nextPollCalls int
}

func (r *pollerTaskRepo) ListRunningByProvider(context.Context, string, time.Time, int) ([]domain.Task, error) {
	return []domain.Task{r.task}, nil
}
func (r *pollerTaskRepo) SetNextPoll(context.Context, int64, time.Time) error {
	r.nextPollCalls++
	return nil
}
func (r *pollerTaskRepo) SetFailure(context.Context, int64, string, string) error {
	r.failureCode = "provider_task_failed"
	return nil
}
func (r *pollerTaskRepo) TransitionForWorker(_ context.Context, _ int64, _, next domain.TaskStatus, _ string) error {
	r.task.Status = next
	return nil
}
func (r *pollerTaskRepo) CompleteWithGeneratedMedia(_ context.Context, _ int64, _ domain.Media, _ string) (bool, error) {
	r.completed++
	r.task.Status = domain.TaskSucceeded
	return r.completed == 1, nil
}

type pollerModelRepo struct{ model models.Definition }

func (r pollerModelRepo) GetVersion(context.Context, int64, int64) (models.Definition, error) {
	return r.model, nil
}

type pollerProvider struct{ result providers.ViduTask }

func (p pollerProvider) Poll(context.Context, models.Definition, string) (providers.ViduTask, error) {
	return p.result, nil
}

func TestPollerPersistsCompletedVideoExactlyOnce(t *testing.T) {
	taskRepo := &pollerTaskRepo{task: domain.Task{ID: 8, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskRunning, Provider: models.AdapterViduImageToVideo, ProviderTaskID: "vidu-42", ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4)}}
	poller := Poller{
		Tasks:          taskRepo,
		Models:         pollerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterViduImageToVideo}},
		Provider:       pollerProvider{result: providers.ViduTask{ID: "vidu-42", State: providers.ViduTaskSucceeded, ResultURL: "https://cdn.vidu.example/clip.mp4"}},
		Objects:        &workerObjects{},
		DownloadResult: func(context.Context, string) ([]byte, string, error) { return []byte("mp4"), "video/mp4", nil },
		Now:            func() time.Time { return time.Date(2026, time.August, 12, 12, 0, 0, 0, time.UTC) },
	}
	if err := poller.PollOnce(context.Background(), taskRepo.task); err != nil {
		t.Fatal(err)
	}
	if taskRepo.completed != 1 || taskRepo.task.Status != domain.TaskSucceeded {
		t.Fatalf("completed=%d status=%s", taskRepo.completed, taskRepo.task.Status)
	}
	if err := poller.PollOnce(context.Background(), taskRepo.task); err != nil && !errors.Is(err, ErrTaskAlreadyCompleted) {
		t.Fatal(err)
	}
	if taskRepo.completed != 1 {
		t.Fatalf("duplicate poll created %d media rows", taskRepo.completed)
	}
}

func TestPollDueCompletesRestoredViduTaskOnce(t *testing.T) {
	taskRepo := &pollerTaskRepo{task: domain.Task{ID: 9, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskRunning, Provider: models.AdapterViduImageToVideo, ProviderTaskID: "vidu-restored", ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4)}}
	poller := Poller{
		Tasks:          taskRepo,
		Models:         pollerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterViduImageToVideo}},
		Provider:       pollerProvider{result: providers.ViduTask{ID: "vidu-restored", State: providers.ViduTaskSucceeded, ResultURL: "https://cdn.vidu.example/recovered.mp4"}},
		Objects:        &workerObjects{},
		DownloadResult: func(context.Context, string) ([]byte, string, error) { return []byte("mp4"), "video/mp4", nil },
		Now:            func() time.Time { return time.Date(2026, time.August, 12, 12, 0, 0, 0, time.UTC) },
	}
	if err := poller.PollDue(context.Background()); err != nil {
		t.Fatal(err)
	}
	if taskRepo.completed != 1 || taskRepo.task.Status != domain.TaskSucceeded {
		t.Fatalf("completed=%d status=%s", taskRepo.completed, taskRepo.task.Status)
	}
	if err := poller.PollDue(context.Background()); err != nil {
		t.Fatal(err)
	}
	if taskRepo.completed != 1 {
		t.Fatalf("restart scan wrote %d media rows", taskRepo.completed)
	}
}
