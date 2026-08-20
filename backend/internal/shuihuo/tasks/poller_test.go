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
	task            domain.Task
	tasksByProvider map[string][]domain.Task
	listProviders   []string
	completed       int
	failureCode     string
	nextPollCalls   int
}

func (r *pollerTaskRepo) ListRunningByProvider(_ context.Context, provider string, _ time.Time, _ int) ([]domain.Task, error) {
	r.listProviders = append(r.listProviders, provider)
	if r.tasksByProvider != nil {
		return r.tasksByProvider[provider], nil
	}
	return []domain.Task{r.task}, nil
}
func (r *pollerTaskRepo) SetNextPoll(context.Context, int64, time.Time) error {
	r.nextPollCalls++
	return nil
}
func (r *pollerTaskRepo) SetFailure(_ context.Context, _ int64, code, _ string) error {
	r.failureCode = code
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

type pollerModelRepo struct {
	model          models.Definition
	modelsByTaskID map[int64]models.Definition
}

func (r pollerModelRepo) GetVersion(_ context.Context, modelID, _ int64) (models.Definition, error) {
	if r.modelsByTaskID != nil {
		return r.modelsByTaskID[modelID], nil
	}
	return r.model, nil
}

type pollerProvider struct {
	result     providers.AsyncVideoTask
	pollCalls  []string
	pollOwners []int64
}

func (p *pollerProvider) Submit(context.Context, models.Definition, models.Request) (models.Response, error) {
	return models.Response{}, errors.New("not implemented")
}

func (p *pollerProvider) Poll(_ context.Context, model models.Definition, ownerID int64, providerTaskID string) (providers.AsyncVideoTask, error) {
	p.pollCalls = append(p.pollCalls, model.AdapterKind+":"+providerTaskID)
	p.pollOwners = append(p.pollOwners, ownerID)
	return p.result, nil
}

func TestPollerPersistsCompletedVideoExactlyOnce(t *testing.T) {
	taskRepo := &pollerTaskRepo{task: domain.Task{ID: 8, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskRunning, Provider: models.AdapterViduImageToVideo, ProviderTaskID: "vidu-42", ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4)}}
	poller := Poller{
		Tasks:          taskRepo,
		Models:         pollerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterViduImageToVideo}},
		Providers:      map[string]providers.AsyncVideoProvider{models.AdapterViduImageToVideo: &pollerProvider{result: providers.AsyncVideoTask{ID: "vidu-42", State: providers.AsyncVideoSucceeded, ResultURL: "https://cdn.vidu.example/clip.mp4"}}},
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
		Providers:      map[string]providers.AsyncVideoProvider{models.AdapterViduImageToVideo: &pollerProvider{result: providers.AsyncVideoTask{ID: "vidu-restored", State: providers.AsyncVideoSucceeded, ResultURL: "https://cdn.vidu.example/recovered.mp4"}}},
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

func TestPollerPersistsCompletedYDVideoExactlyOnce(t *testing.T) {
	taskRepo := &pollerTaskRepo{task: domain.Task{ID: 10, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskRunning, Provider: models.AdapterYDVideo, ProviderTaskID: "yd-42", ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4)}}
	yd := &pollerProvider{result: providers.AsyncVideoTask{ID: "yd-42", State: providers.AsyncVideoSucceeded, ResultURL: "https://cdn.yd.example/clip.mp4"}}
	poller := Poller{
		Tasks:          taskRepo,
		Models:         pollerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo}},
		Providers:      map[string]providers.AsyncVideoProvider{models.AdapterYDVideo: yd},
		Objects:        &workerObjects{},
		DownloadResult: func(context.Context, string) ([]byte, string, error) { return []byte("mp4"), "video/mp4", nil },
	}
	if err := poller.PollOnce(context.Background(), taskRepo.task); err != nil {
		t.Fatal(err)
	}
	if taskRepo.completed != 1 || taskRepo.task.Status != domain.TaskSucceeded {
		t.Fatalf("completed=%d status=%s", taskRepo.completed, taskRepo.task.Status)
	}
	if len(yd.pollCalls) != 1 || yd.pollCalls[0] != models.AdapterYDVideo+":yd-42" {
		t.Fatalf("YD poll calls = %#v", yd.pollCalls)
	}
	if len(yd.pollOwners) != 1 || yd.pollOwners[0] != 17 {
		t.Fatalf("YD poll owners = %#v, want task owner", yd.pollOwners)
	}
	if err := poller.PollOnce(context.Background(), taskRepo.task); err != nil && !errors.Is(err, ErrTaskAlreadyCompleted) {
		t.Fatal(err)
	}
	if taskRepo.completed != 1 {
		t.Fatalf("duplicate poll created %d media rows", taskRepo.completed)
	}
}

func TestPollDueRoutesMixedProvidersInDeterministicOrder(t *testing.T) {
	viduTask := domain.Task{ID: 11, UserID: 17, ProjectID: 3, Kind: "video", Status: domain.TaskRunning, Provider: models.AdapterViduImageToVideo, ProviderTaskID: "vidu-11", ModelID: int64Ptr(11), ModelVersionID: int64Ptr(4)}
	ydTask := domain.Task{ID: 12, UserID: 17, ProjectID: 3, Kind: "video", Status: domain.TaskRunning, Provider: models.AdapterYDVideo, ProviderTaskID: "yd-12", ModelID: int64Ptr(12), ModelVersionID: int64Ptr(4)}
	taskRepo := &pollerTaskRepo{tasksByProvider: map[string][]domain.Task{
		models.AdapterViduImageToVideo: {viduTask},
		models.AdapterYDVideo:          {ydTask},
	}}
	vidu := &pollerProvider{result: providers.AsyncVideoTask{State: providers.AsyncVideoRunning}}
	yd := &pollerProvider{result: providers.AsyncVideoTask{State: providers.AsyncVideoRunning}}
	poller := Poller{
		Tasks: taskRepo,
		Models: pollerModelRepo{modelsByTaskID: map[int64]models.Definition{
			11: {ID: 11, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterViduImageToVideo},
			12: {ID: 12, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo},
		}},
		Providers: map[string]providers.AsyncVideoProvider{
			models.AdapterYDVideo:          yd,
			models.AdapterViduImageToVideo: vidu,
		},
		Objects: &workerObjects{},
	}
	if err := poller.PollDue(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got, want := taskRepo.listProviders, []string{models.AdapterViduImageToVideo, models.AdapterYDVideo}; !sameStrings(got, want) {
		t.Fatalf("providers = %#v, want %#v", got, want)
	}
	if got, want := vidu.pollCalls, []string{models.AdapterViduImageToVideo + ":vidu-11"}; !sameStrings(got, want) {
		t.Fatalf("Vidu poll calls = %#v, want %#v", got, want)
	}
	if got, want := yd.pollCalls, []string{models.AdapterYDVideo + ":yd-12"}; !sameStrings(got, want) {
		t.Fatalf("YD poll calls = %#v, want %#v", got, want)
	}
}

func TestPollerRejectsTaskAndModelAdapterMismatch(t *testing.T) {
	taskRepo := &pollerTaskRepo{task: domain.Task{ID: 13, UserID: 17, ProjectID: 3, Kind: "video", Status: domain.TaskRunning, Provider: models.AdapterYDVideo, ProviderTaskID: "yd-mismatch", ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4)}}
	yd := &pollerProvider{result: providers.AsyncVideoTask{State: providers.AsyncVideoRunning}}
	poller := Poller{
		Tasks:     taskRepo,
		Models:    pollerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterViduImageToVideo}},
		Providers: map[string]providers.AsyncVideoProvider{models.AdapterYDVideo: yd},
		Objects:   &workerObjects{},
	}
	if err := poller.PollOnce(context.Background(), taskRepo.task); err != nil {
		t.Fatal(err)
	}
	if taskRepo.failureCode != "invalid_async_task" || taskRepo.task.Status != domain.TaskFailed {
		t.Fatalf("failure=%q status=%s", taskRepo.failureCode, taskRepo.task.Status)
	}
	if len(yd.pollCalls) != 0 {
		t.Fatalf("YD was called for mismatched task: %#v", yd.pollCalls)
	}
}

func sameStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
