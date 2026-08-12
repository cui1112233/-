package tasks

import (
	"context"
	"errors"
	"testing"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
)

type workerTaskRepo struct {
	task        domain.Task
	transitions [][2]domain.TaskStatus
	output      string
}

func (r *workerTaskRepo) GetForWorker(context.Context, int64) (domain.Task, error) {
	return r.task, nil
}
func (r *workerTaskRepo) TransitionForWorker(_ context.Context, _ int64, current, next domain.TaskStatus, _ string) error {
	r.transitions = append(r.transitions, [2]domain.TaskStatus{current, next})
	r.task.Status = next
	return nil
}
func (r *workerTaskRepo) SetFailure(_ context.Context, _ int64, code, message string) error {
	r.task.ErrorCode, r.task.ErrorMessage = code, message
	return nil
}
func (r *workerTaskRepo) SetOutput(_ context.Context, _ int64, output string) error {
	r.output = output
	return nil
}

type workerModelRepo struct{ model models.Definition }

func (r workerModelRepo) GetVersion(context.Context, int64, int64) (models.Definition, error) {
	return r.model, nil
}

type workerSegmentRepo struct{ segment domain.Segment }

func (r workerSegmentRepo) GetForWorker(context.Context, int64, int64) (domain.Segment, error) {
	return r.segment, nil
}

type workerMediaRepo struct{ primary domain.Media }

func (r workerMediaRepo) PrimaryImage(context.Context, int64, int64) (domain.Media, error) {
	return r.primary, nil
}

type workerObjects struct {
	key    string
	bytes  []byte
	putErr error
}

func (s *workerObjects) PutGenerated(_ context.Context, key string, body []byte, _ string) error {
	if s.putErr != nil {
		return s.putErr
	}
	s.key, s.bytes = key, body
	return nil
}
func (s *workerObjects) Download(context.Context, string) ([]byte, string, error) {
	return nil, "", errors.New("not implemented")
}
func (s *workerObjects) URL(context.Context, string) (string, error) {
	return "https://storage.example.com/image.png", nil
}

type workerAdapter struct {
	response models.Response
	err      error
}

func (a workerAdapter) Submit(context.Context, models.Definition, models.Request) (models.Response, error) {
	return a.response, a.err
}

func TestWorkerMarksImmediateImageTaskSucceededAfterPersistingMedia(t *testing.T) {
	taskRepo := &workerTaskRepo{task: domain.Task{ID: 8, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "image", Status: domain.TaskQueued, ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4), Input: `{"prompt":"雨夜车站"}`}}
	objects := &workerObjects{}
	worker := Worker{
		Tasks: taskRepo, Models: workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindImage}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    &memoryMediaRepo{}, Objects: objects,
		Adapter: workerAdapter{response: models.Response{ResultURL: "https://cdn.example/generated.png"}},
		DownloadResult: func(_ context.Context, raw string) ([]byte, string, error) {
			if got, want := raw, "https://cdn.example/generated.png"; got != want {
				t.Fatalf("result URL = %q, want %q", got, want)
			}
			return []byte("png"), "image/png", nil
		},
	}
	if err := worker.Process(context.Background(), 8); err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if got, want := taskRepo.task.Status, domain.TaskSucceeded; got != want {
		t.Fatalf("status = %s, want %s", got, want)
	}
	if len(objects.bytes) == 0 || objects.key == "" {
		t.Fatalf("generated object was not written: %#v", objects)
	}
	if objects.key[:22] != "shuihuo-production/17/" {
		t.Fatalf("object key = %q, want task owner namespace", objects.key)
	}
	if taskRepo.output == "" {
		t.Fatal("task output was not recorded")
	}
}

func TestWorkerMarksImageDownloadFailureWithVisibleCode(t *testing.T) {
	taskRepo := &workerTaskRepo{task: domain.Task{ID: 9, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "image", Status: domain.TaskQueued, ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4), Input: `{"prompt":"雨夜车站"}`}}
	worker := Worker{
		Tasks: taskRepo, Models: workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindImage}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    &memoryMediaRepo{}, Objects: &workerObjects{}, Adapter: workerAdapter{response: models.Response{ResultURL: "https://cdn.example/generated.png"}},
		DownloadResult: func(context.Context, string) ([]byte, string, error) { return nil, "", errors.New("download denied") },
	}
	if err := worker.Process(context.Background(), 9); err == nil {
		t.Fatal("Process() succeeded after a result download failure")
	}
	if got, want := taskRepo.task.ErrorCode, "download_result_failed"; got != want {
		t.Fatalf("error code = %q, want %q", got, want)
	}
	if len(worker.Media.(*memoryMediaRepo).items) != 0 {
		t.Fatal("media was created after a result download failure")
	}
}

func TestWorkerMarksImageSubmitFailureWithoutMedia(t *testing.T) {
	taskRepo := &workerTaskRepo{task: domain.Task{ID: 10, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "image", Status: domain.TaskQueued, ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4), Input: `{"prompt":"雨夜车站"}`}}
	media := &memoryMediaRepo{}
	worker := Worker{
		Tasks: taskRepo, Models: workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindImage}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    media, Objects: &workerObjects{}, Adapter: workerAdapter{err: errors.New("provider rejected")},
	}
	if err := worker.Process(context.Background(), 10); err == nil {
		t.Fatal("Process() succeeded after a provider submit failure")
	}
	if got, want := taskRepo.task.ErrorCode, "model_submit_failed"; got != want {
		t.Fatalf("error code = %q, want %q", got, want)
	}
	if len(media.items) != 0 {
		t.Fatal("media was created after a provider submit failure")
	}
}

func TestWorkerMarksImageStoreFailureWithoutMedia(t *testing.T) {
	taskRepo := &workerTaskRepo{task: domain.Task{ID: 11, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "image", Status: domain.TaskQueued, ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4), Input: `{"prompt":"雨夜车站"}`}}
	media := &memoryMediaRepo{}
	worker := Worker{
		Tasks: taskRepo, Models: workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindImage}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    media, Objects: &workerObjects{putErr: errors.New("storage unavailable")}, Adapter: workerAdapter{response: models.Response{ResultURL: "https://cdn.example/generated.png"}},
		DownloadResult: func(context.Context, string) ([]byte, string, error) { return []byte("png"), "image/png", nil },
	}
	if err := worker.Process(context.Background(), 11); err == nil {
		t.Fatal("Process() succeeded after an object-storage failure")
	}
	if got, want := taskRepo.task.ErrorCode, "store_result_failed"; got != want {
		t.Fatalf("error code = %q, want %q", got, want)
	}
	if len(media.items) != 0 {
		t.Fatal("media was created before object storage succeeded")
	}
}

func TestWorkerRejectsVideoWithoutPrimaryImage(t *testing.T) {
	taskRepo := &workerTaskRepo{task: domain.Task{ID: 8, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskQueued, ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4), Input: `{"prompt":"镜头推进"}`}}
	worker := Worker{
		Tasks: taskRepo, Models: workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    &memoryMediaRepo{primaryErr: errors.New("no image")}, Objects: &workerObjects{}, Adapter: workerAdapter{},
	}
	if err := worker.Process(context.Background(), 8); err == nil {
		t.Fatal("Process() succeeded without a primary image")
	}
	if got, want := taskRepo.task.Status, domain.TaskFailed; got != want {
		t.Fatalf("status = %s, want %s", got, want)
	}
	if taskRepo.task.ErrorCode != "primary_image_required" {
		t.Fatalf("error code = %q", taskRepo.task.ErrorCode)
	}
}

type memoryMediaRepo struct {
	items      []domain.Media
	primaryErr error
}

func (r *memoryMediaRepo) PrimaryImage(_ context.Context, _, _ int64) (domain.Media, error) {
	if r.primaryErr != nil {
		return domain.Media{}, r.primaryErr
	}
	return domain.Media{}, nil
}
func (r *memoryMediaRepo) CreateGenerated(_ context.Context, media domain.Media) (domain.Media, error) {
	media.ID = int64(len(r.items) + 1)
	r.items = append(r.items, media)
	return media, nil
}

func int64Ptr(value int64) *int64 { return &value }
