package tasks

import (
	"context"
	"errors"
	"reflect"
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
	key      string
	bytes    []byte
	putErr   error
	urls     map[string]string
	urlCalls []string
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
func (s *workerObjects) URL(_ context.Context, key string) (string, error) {
	s.urlCalls = append(s.urlCalls, key)
	if value, ok := s.urls[key]; ok {
		return value, nil
	}
	return "https://storage.example.com/image.png", nil
}

type workerAdapter struct {
	response models.Response
	err      error
}

func (a workerAdapter) Submit(context.Context, models.Definition, models.Request) (models.Response, error) {
	return a.response, a.err
}

type recordingWorkerAdapter struct {
	request  models.Request
	model    models.Definition
	response models.Response
}

func (a *recordingWorkerAdapter) Submit(_ context.Context, model models.Definition, request models.Request) (models.Response, error) {
	a.model, a.request = model, request
	return a.response, nil
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

func TestWorkerExecutesAccountImageTaskForTaskOwner(t *testing.T) {
	taskRepo := &workerTaskRepo{task: domain.Task{
		ID: 18, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "image", Status: domain.TaskQueued,
		Provider: models.AdapterAccountOpenAICompatibleImage,
		Input:    `{"prompt":"雨夜车站","model":"image-model","provider":"account_openai_compatible_image"}`,
	}}
	adapter := &recordingWorkerAdapter{response: models.Response{ResultURL: "https://cdn.example/image.png"}}
	worker := Worker{
		Tasks: taskRepo, Models: workerModelRepo{}, Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media: &memoryMediaRepo{}, Objects: &workerObjects{}, Adapter: adapter,
		DownloadResult: func(context.Context, string) ([]byte, string, error) { return []byte("png"), "image/png", nil },
	}

	if err := worker.Process(context.Background(), 18); err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if adapter.request.OwnerID != 17 || adapter.model.AdapterKind != models.AdapterAccountOpenAICompatibleImage {
		t.Fatalf("adapter request/model = %#v / %#v", adapter.request, adapter.model)
	}
	if taskRepo.task.Status != domain.TaskSucceeded {
		t.Fatalf("status = %s", taskRepo.task.Status)
	}
}

func TestWorkerPassesSnapshottedSegmentAssetReferencesToImageModel(t *testing.T) {
	taskRepo := &workerTaskRepo{task: domain.Task{
		ID: 19, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "image", Status: domain.TaskQueued,
		ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4),
		Input: `{"prompt":"雨夜车站","referenceObjectKeys":["shuihuo-production/17/3/asset-images/hero.png","shuihuo-production/17/3/asset-images/station.png"]}`,
	}}
	adapter := &recordingWorkerAdapter{response: models.Response{ResultURL: "https://cdn.example/image.png"}}
	worker := Worker{
		Tasks: taskRepo, Models: workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindImage, AdapterKind: models.AdapterGenericHTTP}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    &memoryMediaRepo{}, Objects: &workerObjects{}, Adapter: adapter,
		DownloadResult: func(context.Context, string) ([]byte, string, error) { return []byte("png"), "image/png", nil },
	}

	if err := worker.Process(context.Background(), 19); err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if got, want := adapter.request.ReferenceImageURLs, []string{
		"https://storage.example.com/image.png",
		"https://storage.example.com/image.png",
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("reference image URLs = %#v, want %#v", got, want)
	}
}

func TestWorkerUsesSnapshottedStoryboardImageForVideo(t *testing.T) {
	taskRepo := &workerTaskRepo{task: domain.Task{
		ID: 20, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskQueued,
		ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4),
		Input: `{"prompt":"镜头推进","sourceImageObjectKey":"shuihuo-production/17/3/images/selected.png"}`,
	}}
	adapter := &recordingWorkerAdapter{response: models.Response{ResultURL: "https://cdn.example/video.mp4"}}
	worker := Worker{
		Tasks: taskRepo, Models: workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterViduImageToVideo}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    &memoryMediaRepo{primaryErr: errors.New("the current primary image must not be read")}, Objects: &workerObjects{}, Adapter: adapter,
		DownloadResult: func(context.Context, string) ([]byte, string, error) { return []byte("video"), "video/mp4", nil },
	}

	if err := worker.Process(context.Background(), 20); err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if got, want := adapter.request.ImageURL, "https://storage.example.com/image.png"; got != want {
		t.Fatalf("video source image URL = %q, want %q", got, want)
	}
}

func TestWorkerUsesYDVideoSnapshotReferencesBeforeSceneAndAcceptsAsyncTask(t *testing.T) {
	taskRepo := &asyncWorkerTaskRepo{task: domain.Task{
		ID: 22, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskQueued,
		ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4), Provider: models.AdapterYDVideo,
		Input: `{"prompt":"镜头推进","sourceImageObjectKey":"shuihuo-production/17/3/images/scene.png","aspectRatio":"16:9","videoReferenceObjectKeys":["shuihuo-production/17/3/asset-images/hero.png","shuihuo-production/17/3/asset-images/prop.png"]}`,
	}}
	objects := &workerObjects{urls: map[string]string{
		"shuihuo-production/17/3/asset-images/hero.png": "https://storage.example.com/hero.png",
		"shuihuo-production/17/3/asset-images/prop.png": "https://storage.example.com/prop.png",
		"shuihuo-production/17/3/images/scene.png":      "https://storage.example.com/scene.png",
	}}
	adapter := &recordingWorkerAdapter{response: models.Response{ProviderTaskID: "yd-42"}}
	worker := Worker{
		Tasks: taskRepo, Models: workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    &memoryMediaRepo{primaryErr: errors.New("worker must use the task snapshot")}, Objects: objects, Adapter: adapter,
	}

	if err := worker.Process(context.Background(), 22); err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if got, want := objects.urlCalls, []string{
		"shuihuo-production/17/3/asset-images/hero.png",
		"shuihuo-production/17/3/asset-images/prop.png",
		"shuihuo-production/17/3/images/scene.png",
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("resolved object keys = %#v, want %#v", got, want)
	}
	if got, want := adapter.request.ReferenceImageURLs, []string{"https://storage.example.com/hero.png", "https://storage.example.com/prop.png"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("reference URLs = %#v, want %#v", got, want)
	}
	if adapter.request.ImageURL != "https://storage.example.com/scene.png" || adapter.request.AspectRatio != "16:9" {
		t.Fatalf("YD request = %#v", adapter.request)
	}
	if taskRepo.task.Status != domain.TaskRunning || taskRepo.task.ProviderTaskID != "yd-42" {
		t.Fatalf("async task = %#v", taskRepo.task)
	}
}

func TestWorkerRejectsLocalYDSceneURLBeforeSubmitting(t *testing.T) {
	taskRepo := &workerTaskRepo{task: domain.Task{
		ID: 23, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskQueued,
		ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4), Provider: models.AdapterYDVideo,
		Input: `{"prompt":"镜头推进","sourceImageObjectKey":"shuihuo-production/17/3/images/scene.png","aspectRatio":"9:16"}`,
	}}
	adapter := &recordingWorkerAdapter{}
	worker := Worker{
		Tasks: taskRepo, Models: workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    &memoryMediaRepo{}, Objects: &workerObjects{urls: map[string]string{"shuihuo-production/17/3/images/scene.png": "https://127.0.0.1/scene.png"}}, Adapter: adapter,
	}

	if err := worker.Process(context.Background(), 23); err == nil {
		t.Fatal("Process() succeeded with a local scene URL")
	}
	if taskRepo.task.ErrorCode != "primary_image_url_invalid" {
		t.Fatalf("error code = %q", taskRepo.task.ErrorCode)
	}
	if adapter.request.Prompt != "" || adapter.request.ImageURL != "" || len(adapter.request.ReferenceImageURLs) != 0 {
		t.Fatalf("adapter received request = %#v", adapter.request)
	}
}

func TestWorkerSubmitsVideoPromptWithoutImageWhenTaskHasNoStoryboardImage(t *testing.T) {
	taskRepo := &workerTaskRepo{task: domain.Task{
		ID: 21, UserID: 17, ProjectID: 3, SegmentID: int64Ptr(5), Kind: "video", Status: domain.TaskQueued,
		ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4), Input: `{"prompt":"镜头从远景推至人物特写"}`,
	}}
	adapter := &recordingWorkerAdapter{response: models.Response{ResultURL: "https://cdn.example/video.mp4"}}
	worker := Worker{
		Tasks: taskRepo, Models: workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterGenericHTTP}},
		Segments: workerSegmentRepo{segment: domain.Segment{ID: 5, ProjectID: 3, Confirmed: true}},
		Media:    &memoryMediaRepo{primaryErr: errors.New("no image exists")}, Objects: &workerObjects{}, Adapter: adapter,
		DownloadResult: func(context.Context, string) ([]byte, string, error) { return []byte("video"), "video/mp4", nil },
	}

	if err := worker.Process(context.Background(), 21); err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if adapter.request.ImageURL != "" {
		t.Fatalf("video task without a storyboard image passed ImageURL = %q", adapter.request.ImageURL)
	}
	if got, want := adapter.request.Prompt, "镜头从远景推至人物特写"; got != want {
		t.Fatalf("video prompt = %q, want %q", got, want)
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
		Tasks: taskRepo, Models: workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindVideo, AdapterKind: models.AdapterViduImageToVideo}},
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

type memoryAssetImageRepo struct{ items []domain.AssetImage }

func (r *memoryAssetImageRepo) CreateGenerated(_ context.Context, image domain.AssetImage) (domain.AssetImage, error) {
	image.ID = int64(len(r.items) + 1)
	r.items = append(r.items, image)
	return image, nil
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

func TestWorkerPersistsAssetImageWithoutCreatingStoryboardMedia(t *testing.T) {
	taskRepo := &workerTaskRepo{task: domain.Task{ID: 15, UserID: 17, ProjectID: 3, Kind: "asset_image", Status: domain.TaskQueued, ModelID: int64Ptr(2), ModelVersionID: int64Ptr(4), Input: `{"prompt":"白衣剑客，国风水墨","assetId":21}`}}
	media := &memoryMediaRepo{}
	assetImages := &memoryAssetImageRepo{}
	worker := Worker{
		Tasks: taskRepo, Models: workerModelRepo{model: models.Definition{ID: 2, VersionID: 4, Kind: models.KindImage}},
		Media: media, AssetImages: assetImages, Objects: &workerObjects{}, Adapter: workerAdapter{response: models.Response{ResultURL: "https://cdn.example/asset.png"}},
		DownloadResult: func(context.Context, string) ([]byte, string, error) { return []byte("png"), "image/png", nil },
	}
	if err := worker.Process(context.Background(), 15); err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if len(media.items) != 0 {
		t.Fatalf("storyboard media = %#v, want none", media.items)
	}
	if len(assetImages.items) != 1 || assetImages.items[0].AssetID != 21 {
		t.Fatalf("asset images = %#v, want one image for asset 21", assetImages.items)
	}
}
