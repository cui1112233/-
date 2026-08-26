package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
)

const generatedObjectPrefix = "generated"
const maxGeneratedResultBytes = 256 << 20

type WorkerTaskRepository interface {
	GetForWorker(context.Context, int64) (domain.Task, error)
	TransitionForWorker(context.Context, int64, domain.TaskStatus, domain.TaskStatus, string) error
	SetFailure(context.Context, int64, string, string) error
	SetOutput(context.Context, int64, string) error
}

type AsyncVideoTaskRepository interface {
	SetProviderTask(context.Context, int64, string, time.Time) error
}

type WorkerModelRepository interface {
	GetVersion(context.Context, int64, int64) (models.Definition, error)
}

type WorkerSegmentRepository interface {
	GetForWorker(context.Context, int64, int64) (domain.Segment, error)
}

type WorkerMediaRepository interface {
	PrimaryImage(context.Context, int64, int64) (domain.Media, error)
	CreateGenerated(context.Context, domain.Media) (domain.Media, error)
}

type WorkerObjects interface {
	PutGenerated(context.Context, string, []byte, string) error
	Download(context.Context, string) ([]byte, string, error)
	URL(context.Context, string) (string, error)
}

type Worker struct {
	Tasks          WorkerTaskRepository
	Models         WorkerModelRepository
	Segments       WorkerSegmentRepository
	Media          WorkerMediaRepository
	Objects        WorkerObjects
	Adapter        models.Adapter
	DownloadResult func(context.Context, string) ([]byte, string, error)
}

func (w Worker) Run(ctx context.Context, queue Queue) error {
	if queue == nil {
		return fmt.Errorf("shuihuo Redis queue is not configured")
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		taskID, err := queue.Dequeue(ctx, 3*time.Second)
		if errors.Is(err, context.DeadlineExceeded) {
			continue
		}
		if err != nil {
			return err
		}
		_ = w.Process(ctx, taskID)
	}
}

func (w Worker) Process(ctx context.Context, taskID int64) error {
	if w.Tasks == nil || w.Models == nil || w.Segments == nil || w.Media == nil || w.Objects == nil || w.Adapter == nil {
		return fmt.Errorf("shuihuo task worker is not configured")
	}
	task, err := w.Tasks.GetForWorker(ctx, taskID)
	if err != nil {
		return err
	}
	if task.Status != domain.TaskQueued {
		return nil
	}
	if err := w.Tasks.TransitionForWorker(ctx, task.ID, domain.TaskQueued, domain.TaskRunning, "Worker 开始处理"); err != nil {
		return err
	}
	fail := func(code string, cause error) error {
		message := "任务执行失败"
		if cause != nil {
			message = cause.Error()
		}
		_ = w.Tasks.SetFailure(ctx, task.ID, code, message)
		if transitionErr := w.Tasks.TransitionForWorker(ctx, task.ID, domain.TaskRunning, domain.TaskFailed, message); transitionErr != nil {
			return transitionErr
		}
		return cause
	}
	if task.SegmentID == nil || task.ModelID == nil || task.ModelVersionID == nil {
		return fail("invalid_task", errors.New("任务缺少分段或模型快照"))
	}
	segment, err := w.Segments.GetForWorker(ctx, task.ProjectID, *task.SegmentID)
	if err != nil || !segment.Confirmed {
		if err == nil {
			err = errors.New("分段未确认")
		}
		return fail("segment_unavailable", err)
	}
	model, err := w.Models.GetVersion(ctx, *task.ModelID, *task.ModelVersionID)
	if err != nil {
		return fail("model_unavailable", err)
	}
	if !taskKindMatchesModel(task.Kind, model.Kind) {
		return fail("model_kind_mismatch", errors.New("模型能力与任务类型不匹配"))
	}
	request, err := requestFromTask(task)
	if err != nil {
		return fail("invalid_input", err)
	}
	if task.Kind == "video" && videoRequiresPrimaryImage(model) {
		primary, primaryErr := w.Media.PrimaryImage(ctx, task.ProjectID, *task.SegmentID)
		if primaryErr != nil || primary.ObjectKey == "" {
			if primaryErr == nil {
				primaryErr = errors.New("请先为该分段选择主图片")
			}
			return fail("primary_image_required", primaryErr)
		}
		request.ImageURL, err = w.Objects.URL(ctx, primary.ObjectKey)
		if err != nil {
			return fail("primary_image_url_failed", err)
		}
	}
	response, err := w.Adapter.Submit(ctx, model, request)
	if err != nil {
		return fail("model_submit_failed", err)
	}
	if response.ProviderTaskID != "" && response.ResultURL == "" {
		asyncTasks, ok := w.Tasks.(AsyncVideoTaskRepository)
		if !ok || task.Kind != "video" || !supportsAsyncVideo(model) {
			return fail("async_model_not_configured", errors.New("模型已返回上游任务 ID，但未配置受控视频轮询"))
		}
		if err := asyncTasks.SetProviderTask(ctx, task.ID, response.ProviderTaskID, time.Now().UTC()); err != nil {
			return fail("save_provider_task_failed", err)
		}
		return nil
	}
	if response.ResultURL == "" {
		return fail("empty_model_result", errors.New("模型未返回结果素材"))
	}
	downloadResult := w.DownloadResult
	if downloadResult == nil {
		downloadResult = downloadModelResult
	}
	body, contentType, err := downloadResult(ctx, response.ResultURL)
	if err != nil {
		return fail("download_result_failed", err)
	}
	category, kind, filename := generatedObjectDetails(task.Kind, contentType, task.ID)
	key, err := shuihuostorage.ObjectKey(task.UserID, task.ProjectID, category, filename)
	if err != nil {
		return fail("object_key_failed", err)
	}
	if err := w.Objects.PutGenerated(ctx, key, body, contentType); err != nil {
		return fail("store_result_failed", err)
	}
	media, err := w.Media.CreateGenerated(ctx, domain.Media{ProjectID: task.ProjectID, SegmentID: task.SegmentID, TaskID: &task.ID, Kind: kind, ObjectKey: key, Source: "generated", IsPrimary: task.Kind == "image"})
	if err != nil {
		return fail("save_media_failed", err)
	}
	output, _ := json.Marshal(map[string]any{"mediaId": media.ID, "objectKey": key, "providerTaskId": response.ProviderTaskID})
	if err := w.Tasks.SetOutput(ctx, task.ID, string(output)); err != nil {
		return fail("save_task_output_failed", err)
	}
	if err := w.Tasks.TransitionForWorker(ctx, task.ID, domain.TaskRunning, domain.TaskSucceeded, "生成素材已保存"); err != nil {
		return err
	}
	return nil
}

func requestFromTask(task domain.Task) (models.Request, error) {
	var input struct {
		Prompt      string `json:"prompt"`
		Duration    string `json:"duration"`
		AspectRatio string `json:"aspectRatio"`
		Resolution  string `json:"resolution"`
		CallbackURL string `json:"callbackUrl"`
	}
	if err := json.Unmarshal([]byte(task.Input), &input); err != nil {
		return models.Request{}, fmt.Errorf("读取任务提示词: %w", err)
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return models.Request{}, errors.New("任务提示词为空")
	}
	return models.Request{
		Prompt:      input.Prompt,
		Duration:    input.Duration,
		AspectRatio: input.AspectRatio,
		Resolution:  input.Resolution,
		CallbackURL: input.CallbackURL,
	}, nil
}

func promptFromTask(task domain.Task) (string, error) {
	request, err := requestFromTask(task)
	return request.Prompt, err
}

func videoRequiresPrimaryImage(model models.Definition) bool {
	return model.RequiresImageInput()
}

func supportsAsyncVideo(model models.Definition) bool {
	if model.AdapterKind == models.AdapterViduImageToVideo {
		return true
	}
	return model.AdapterKind == models.AdapterGenericHTTP && strings.TrimSpace(model.PollingTemplate) != ""
}

func taskKindMatchesModel(kind string, modelKind models.Kind) bool {
	return (kind == "image" && modelKind == models.KindImage) || (kind == "video" && modelKind == models.KindVideo) || (kind == "audio" && modelKind == models.KindAudio)
}

func generatedObjectDetails(taskKind, contentType string, taskID int64) (category, kind, filename string) {
	category, kind = "images", "image"
	extension := ".png"
	if taskKind == "video" {
		category, kind, extension = "videos", "video", ".mp4"
	}
	if taskKind == "audio" {
		category, kind, extension = "audio", "audio", ".mp3"
	}
	if extensions, err := mime.ExtensionsByType(contentType); err == nil && len(extensions) > 0 {
		extension = extensions[0]
	}
	return category, kind, fmt.Sprintf("%s-%d%s", generatedObjectPrefix, taskID, extension)
}

func downloadModelResult(ctx context.Context, raw string) ([]byte, string, error) {
	resultURL, err := models.ValidateOutboundURL(raw)
	if err != nil {
		return nil, "", fmt.Errorf("模型结果 URL 必须是公共 HTTPS 地址: %w", err)
	}
	client := &http.Client{
		Timeout: 5 * time.Minute,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("模型结果 URL 重定向次数过多")
			}
			if _, err := models.ValidateOutboundURL(request.URL.String()); err != nil {
				return fmt.Errorf("模型结果重定向 URL 无效: %w", err)
			}
			return nil
		},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, resultURL.String(), nil)
	if err != nil {
		return nil, "", err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", fmt.Errorf("下载模型结果失败: HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxGeneratedResultBytes+1))
	if err != nil || len(body) == 0 || len(body) > maxGeneratedResultBytes {
		return nil, "", errors.New("模型结果文件无效或过大")
	}
	contentType := response.Header.Get("Content-Type")
	if contentType == "" {
		contentType = mime.TypeByExtension(path.Ext(response.Request.URL.Path))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	return body, contentType, nil
}
