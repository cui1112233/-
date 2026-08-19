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
const maxGeneratedResultBytes = 64 << 20

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

// WorkerAssetImageRepository persists reference images for project assets. It
// is deliberately separate from storyboard media so an asset render can never
// replace a segment image.
type WorkerAssetImageRepository interface {
	CreateGenerated(context.Context, domain.AssetImage) (domain.AssetImage, error)
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
	AssetImages    WorkerAssetImageRepository
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
	if w.Tasks == nil || w.Models == nil || w.Objects == nil || w.Adapter == nil {
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
	if task.Kind == "asset_image" {
		if w.AssetImages == nil {
			return fail("worker_not_configured", errors.New("资产图片存储未配置"))
		}
	} else {
		if task.SegmentID == nil || w.Segments == nil || w.Media == nil {
			return fail("invalid_task", errors.New("任务缺少分段或媒体存储"))
		}
		segment, segmentErr := w.Segments.GetForWorker(ctx, task.ProjectID, *task.SegmentID)
		if segmentErr != nil || !segment.Confirmed {
			if segmentErr == nil {
				segmentErr = errors.New("分段未确认")
			}
			return fail("segment_unavailable", segmentErr)
		}
	}
	var model models.Definition
	if task.Provider == models.AdapterAccountOpenAICompatibleImage {
		if (task.Kind != "image" && task.Kind != "asset_image") || task.ModelID != nil || task.ModelVersionID != nil {
			return fail("invalid_task", errors.New("账号生图任务模型快照无效"))
		}
		model = models.Definition{Kind: models.KindImage, AdapterKind: models.AdapterAccountOpenAICompatibleImage}
	} else {
		if task.ModelID == nil || task.ModelVersionID == nil {
			return fail("invalid_task", errors.New("任务缺少模型快照"))
		}
		model, err = w.Models.GetVersion(ctx, *task.ModelID, *task.ModelVersionID)
		if err != nil {
			return fail("model_unavailable", err)
		}
	}
	if !taskKindMatchesModel(task.Kind, model.Kind) {
		return fail("model_kind_mismatch", errors.New("模型能力与任务类型不匹配"))
	}
	prompt, err := promptFromTask(task)
	if err != nil {
		return fail("invalid_input", err)
	}
	request := models.Request{Prompt: prompt, OwnerID: task.UserID}
	if task.Kind == "image" {
		referenceKeys, referenceErr := referenceObjectKeysFromTask(task)
		if referenceErr != nil {
			return fail("invalid_input", referenceErr)
		}
		for _, objectKey := range referenceKeys {
			referenceURL, referenceURLErr := w.Objects.URL(ctx, objectKey)
			if referenceURLErr != nil {
				return fail("reference_image_url_failed", referenceURLErr)
			}
			request.ReferenceImageURLs = append(request.ReferenceImageURLs, referenceURL)
		}
	}
	if task.Kind == "audio" {
		audioSettings, settingsErr := audioSettingsFromTask(task)
		if settingsErr != nil {
			return fail("invalid_input", settingsErr)
		}
		request.Voice = audioSettings.Voice
		request.SpeechRate = audioSettings.SpeechRate
		request.Pitch = audioSettings.Pitch
	}
	if task.Kind == "video" {
		sourceObjectKey, sourceErr := videoSourceObjectKeyFromTask(task)
		if sourceErr != nil {
			return fail("invalid_input", sourceErr)
		}
		if sourceObjectKey == "" {
			primary, primaryErr := w.Media.PrimaryImage(ctx, task.ProjectID, *task.SegmentID)
			if primaryErr != nil || primary.ObjectKey == "" {
				if model.RequiresVideoImage() {
					if primaryErr == nil {
						primaryErr = errors.New("请先为该分段选择主图片")
					}
					return fail("primary_image_required", primaryErr)
				}
			} else {
				sourceObjectKey = primary.ObjectKey
			}
		}
		if sourceObjectKey != "" {
			request.ImageURL, err = w.Objects.URL(ctx, sourceObjectKey)
			if err != nil {
				return fail("primary_image_url_failed", err)
			}
		}
	}
	response, err := w.Adapter.Submit(ctx, model, request)
	if err != nil {
		return fail("model_submit_failed", err)
	}
	if response.ProviderTaskID != "" && response.ResultURL == "" {
		asyncTasks, ok := w.Tasks.(AsyncVideoTaskRepository)
		if !ok || task.Kind != "video" || model.AdapterKind != models.AdapterViduImageToVideo {
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
	outputSnapshot := map[string]any{"providerTaskId": response.ProviderTaskID}
	if task.Kind == "asset_image" {
		assetID, assetErr := assetIDFromTask(task)
		if assetErr != nil {
			return fail("invalid_input", assetErr)
		}
		assetImage, createErr := w.AssetImages.CreateGenerated(ctx, domain.AssetImage{ProjectID: task.ProjectID, AssetID: assetID, TaskID: &task.ID, ObjectKey: key})
		if createErr != nil {
			return fail("save_asset_image_failed", createErr)
		}
		outputSnapshot["assetImageId"] = assetImage.ID
	} else {
		media, createErr := w.Media.CreateGenerated(ctx, domain.Media{ProjectID: task.ProjectID, SegmentID: task.SegmentID, TaskID: &task.ID, Kind: kind, ObjectKey: key, Source: "generated", IsPrimary: task.Kind == "image"})
		if createErr != nil {
			return fail("save_media_failed", createErr)
		}
		outputSnapshot["mediaId"] = media.ID
	}
	output, _ := json.Marshal(outputSnapshot)
	if err := w.Tasks.SetOutput(ctx, task.ID, string(output)); err != nil {
		return fail("save_task_output_failed", err)
	}
	if err := w.Tasks.TransitionForWorker(ctx, task.ID, domain.TaskRunning, domain.TaskSucceeded, "生成素材已保存"); err != nil {
		return err
	}
	return nil
}

func promptFromTask(task domain.Task) (string, error) {
	var input struct {
		Prompt string `json:"prompt"`
	}
	if err := json.Unmarshal([]byte(task.Input), &input); err != nil {
		return "", fmt.Errorf("读取任务提示词: %w", err)
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return "", errors.New("任务提示词为空")
	}
	return input.Prompt, nil
}

func assetIDFromTask(task domain.Task) (int64, error) {
	var input struct {
		AssetID int64 `json:"assetId"`
	}
	if err := json.Unmarshal([]byte(task.Input), &input); err != nil {
		return 0, fmt.Errorf("读取资产图片任务: %w", err)
	}
	if input.AssetID < 1 {
		return 0, errors.New("资产图片任务缺少资产 ID")
	}
	return input.AssetID, nil
}

func referenceObjectKeysFromTask(task domain.Task) ([]string, error) {
	var input struct {
		ReferenceObjectKeys []string `json:"referenceObjectKeys"`
	}
	if err := json.Unmarshal([]byte(task.Input), &input); err != nil {
		return nil, fmt.Errorf("读取生图参考图: %w", err)
	}
	seen := make(map[string]struct{}, len(input.ReferenceObjectKeys))
	keys := make([]string, 0, len(input.ReferenceObjectKeys))
	for _, objectKey := range input.ReferenceObjectKeys {
		objectKey = strings.TrimSpace(objectKey)
		if objectKey == "" {
			continue
		}
		if !shuihuostorage.ValidObjectKey(objectKey) {
			return nil, errors.New("生图参考图无效")
		}
		if _, duplicate := seen[objectKey]; duplicate {
			continue
		}
		seen[objectKey] = struct{}{}
		keys = append(keys, objectKey)
	}
	return keys, nil
}

func videoSourceObjectKeyFromTask(task domain.Task) (string, error) {
	var input struct {
		SourceImageObjectKey string `json:"sourceImageObjectKey"`
	}
	if err := json.Unmarshal([]byte(task.Input), &input); err != nil {
		return "", fmt.Errorf("读取视频参考图: %w", err)
	}
	objectKey := strings.TrimSpace(input.SourceImageObjectKey)
	if objectKey != "" && !shuihuostorage.ValidObjectKey(objectKey) {
		return "", errors.New("视频参考图无效")
	}
	return objectKey, nil
}

func audioSettingsFromTask(task domain.Task) (struct {
	Voice      string
	SpeechRate float64
	Pitch      float64
}, error) {
	settings := struct {
		Voice      string  `json:"voice"`
		SpeechRate float64 `json:"speechRate"`
		Pitch      float64 `json:"pitch"`
	}{SpeechRate: 1}
	if err := json.Unmarshal([]byte(task.Input), &settings); err != nil {
		return struct {
			Voice      string
			SpeechRate float64
			Pitch      float64
		}{}, fmt.Errorf("读取配音设置: %w", err)
	}
	if settings.SpeechRate == 0 {
		settings.SpeechRate = 1
	}
	if settings.SpeechRate < 0.5 || settings.SpeechRate > 2 || settings.Pitch < -50 || settings.Pitch > 50 {
		return struct {
			Voice      string
			SpeechRate float64
			Pitch      float64
		}{}, errors.New("配音设置超出允许范围")
	}
	return struct {
		Voice      string
		SpeechRate float64
		Pitch      float64
	}{Voice: strings.TrimSpace(settings.Voice), SpeechRate: settings.SpeechRate, Pitch: settings.Pitch}, nil
}

func taskKindMatchesModel(kind string, modelKind models.Kind) bool {
	return ((kind == "image" || kind == "asset_image") && modelKind == models.KindImage) || (kind == "video" && modelKind == models.KindVideo) || (kind == "audio" && modelKind == models.KindAudio)
}

func generatedObjectDetails(taskKind, contentType string, taskID int64) (category, kind, filename string) {
	category, kind = "images", "image"
	if taskKind == "asset_image" {
		category, kind = "asset-images", "image"
	}
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
	client := &http.Client{Timeout: 90 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
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
		contentType = mime.TypeByExtension(path.Ext(resultURL.Path))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	return body, contentType, nil
}
