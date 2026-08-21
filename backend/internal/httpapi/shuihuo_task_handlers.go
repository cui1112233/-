package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
	"qiantie/backend/internal/store"

	"github.com/go-chi/chi/v5"
)

type shuihuoTaskRequest struct {
	SegmentID     int64                     `json:"segmentId"`
	Kind          string                    `json:"kind"`
	ModelID       int64                     `json:"modelId"`
	AudioSettings *shuihuoAudioTaskSettings `json:"audioSettings,omitempty"`
	VideoSettings *shuihuoVideoTaskSettings `json:"videoSettings,omitempty"`
}

type shuihuoBatchTaskRequest struct {
	SegmentIDs             []int64                            `json:"segmentIds"`
	Kind                   string                             `json:"kind"`
	ModelID                int64                              `json:"modelId"`
	AudioSettingsBySegment map[int64]shuihuoAudioTaskSettings `json:"audioSettingsBySegment,omitempty"`
	VideoSettings          *shuihuoVideoTaskSettings          `json:"videoSettings,omitempty"`
	VideoSettingsBySegment map[int64]shuihuoVideoTaskSettings `json:"videoSettingsBySegment,omitempty"`
}

// shuihuoAudioTaskSettings contains only user-visible synthesis choices. The
// model's credential, endpoint and request template remain server-side.
type shuihuoAudioTaskSettings struct {
	Voice      string   `json:"voice"`
	SpeechRate *float64 `json:"speechRate,omitempty"`
	Pitch      *float64 `json:"pitch,omitempty"`
}

type shuihuoVideoTaskSettings struct {
	AspectRatio string `json:"aspectRatio"`
}

type shuihuoBatchTaskResult struct {
	SegmentID int64              `json:"segmentId"`
	Task      *domain.PublicTask `json:"task,omitempty"`
	Error     string             `json:"error,omitempty"`
}

const accountOpenAICompatibleImageModelID int64 = 0

type shuihuoTaskCreationError struct {
	message       string
	singleMessage string
}

func (err shuihuoTaskCreationError) Error() string { return err.message }

func taskCreationError(message string) error {
	return shuihuoTaskCreationError{message: message, singleMessage: message}
}

func taskCreationErrorWithSingleMessage(message, singleMessage string) error {
	return shuihuoTaskCreationError{message: message, singleMessage: singleMessage}
}

func taskCreationErrorMessage(err error) string {
	var creationError shuihuoTaskCreationError
	if errors.As(err, &creationError) {
		return creationError.message
	}
	return "提交任务失败"
}

func singleTaskCreationErrorMessage(err error) string {
	var creationError shuihuoTaskCreationError
	if errors.As(err, &creationError) && creationError.singleMessage != "" {
		return creationError.singleMessage
	}
	return taskCreationErrorMessage(err)
}

func (api *API) handleListShuihuoModels(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	items, err := shuihuostore.NewModels(api.deps.DB).ListEnabled(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取模型失败"})
		return
	}
	public := make([]models.PublicModel, 0, len(items))
	for _, item := range items {
		if item.Kind == models.KindImage && !item.SupportsTaskExecution() {
			continue
		}
		if item.PubliclySelectable() {
			public = append(public, models.ToPublic(item))
		}
	}
	user, _ := currentUser(r)
	accountImageModel, configured, imageErr := api.accountOpenAICompatibleImageModel(r.Context(), user.ID)
	if imageErr != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取账号图片配置失败"})
		return
	}
	if configured {
		public = append(public, accountImageModel)
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": public})
}

func (api *API) handleListShuihuoTasks(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	tasks, err := shuihuostore.NewTasks(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取任务失败"})
		return
	}
	public := make([]domain.PublicTask, 0, len(tasks))
	for _, task := range tasks {
		public = append(public, domain.ToPublicTask(task))
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": public})
}

func (api *API) handleCreateShuihuoTask(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req shuihuoTaskRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	user, _ := currentUser(r)
	task, err := api.createShuihuoTask(r.Context(), user, project, req.SegmentID, req.ModelID, req.Kind, req.AudioSettings, req.VideoSettings)
	if err != nil {
		writeJSON(w, taskCreationStatus(err), map[string]string{"error": singleTaskCreationErrorMessage(err)})
		return
	}
	writeJSON(w, http.StatusCreated, domain.ToPublicTask(task))
}

func (api *API) handleCreateShuihuoBatchTasks(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req shuihuoBatchTaskRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if !validBatchTaskRequest(req) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "任务参数无效"})
		return
	}
	user, _ := currentUser(r)
	if err := api.validateBatchSharedVideoSettings(r.Context(), req); err != nil {
		writeJSON(w, taskCreationStatus(err), map[string]string{"error": taskCreationErrorMessage(err)})
		return
	}
	results := make([]shuihuoBatchTaskResult, 0, len(req.SegmentIDs))
	allSucceeded := true
	for _, segmentID := range req.SegmentIDs {
		var audioSettings *shuihuoAudioTaskSettings
		var videoSettings *shuihuoVideoTaskSettings
		if req.Kind == "audio" {
			settings := req.AudioSettingsBySegment[segmentID]
			audioSettings = &settings
		}
		if req.Kind == "video" {
			if req.VideoSettings != nil {
				videoSettings = req.VideoSettings
			} else if settings, ok := req.VideoSettingsBySegment[segmentID]; ok {
				videoSettings = &settings
			}
		}
		task, err := api.createShuihuoTask(r.Context(), user, project, segmentID, req.ModelID, req.Kind, audioSettings, videoSettings)
		result := shuihuoBatchTaskResult{SegmentID: segmentID}
		if err != nil {
			allSucceeded = false
			result.Error = taskCreationErrorMessage(err)
		} else {
			item := domain.ToPublicTask(task)
			result.Task = &item
		}
		results = append(results, result)
	}
	status := http.StatusCreated
	if !allSucceeded {
		status = http.StatusMultiStatus
	}
	writeJSON(w, status, map[string]any{"results": results})
}

func validBatchTaskRequest(req shuihuoBatchTaskRequest) bool {
	if len(req.SegmentIDs) == 0 || len(req.SegmentIDs) > 50 || req.ModelID < 0 || (req.ModelID == accountOpenAICompatibleImageModelID && req.Kind != "image") || !validTaskKind(req.Kind) || req.Kind == "export" {
		return false
	}
	seen := make(map[int64]struct{}, len(req.SegmentIDs))
	for _, segmentID := range req.SegmentIDs {
		if segmentID < 1 {
			return false
		}
		if _, duplicate := seen[segmentID]; duplicate {
			return false
		}
		seen[segmentID] = struct{}{}
	}
	return true
}

// validateBatchSharedVideoSettings performs model-specific validation before
// the first task can be persisted. Per-segment settings remain a legacy path
// and are validated by each individual task creation.
func (api *API) validateBatchSharedVideoSettings(ctx context.Context, req shuihuoBatchTaskRequest) error {
	// Display clients no longer choose rendering dimensions per batch. The
	// server reads the saved engine settings for every task, so legacy payloads
	// are intentionally ignored instead of overriding those settings.
	_ = ctx
	_ = req
	return nil
}

func taskCreationStatus(err error) int {
	switch taskCreationErrorMessage(err) {
	case "任务参数无效", "模型类型与任务不匹配", "YD 视频比例仅支持 9:16 或 16:9", "图生视频需要当前分镜的预设图或主图片", "所选视频模型仅支持图生视频，请在引擎设置中切换图生视频":
		return http.StatusBadRequest
	case "分段不存在":
		return http.StatusNotFound
	case "请先确认分段", "所选模型未启用或不存在", "所选模型尚未完成运行配置，请联系管理员配置凭据引用和提供方参数", "请先在设置中完成 OpenAI 兼容生图配置", "请先在工作台设置中配置中转亚迪 API Key", "请先保存对应提示词", "所选图片模型不支持分镜预设参考图，请在模型配置中使用参考图占位符或改选支持参考图的模型", "所选视频模型需要当前分镜画面图片，请先生成图片或改选文生视频模型":
		return http.StatusConflict
	case "分镜已变更，请刷新后重试":
		return http.StatusConflict
	case "该模型仅限所有者使用":
		return http.StatusForbidden
	case "任务队列未配置，无法提交生成任务", "任务队列不可用，未提交生成任务":
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

func (api *API) createShuihuoTask(ctx context.Context, user store.User, project domain.Project, segmentID, modelID int64, kind string, audioSettings *shuihuoAudioTaskSettings, videoSettings *shuihuoVideoTaskSettings) (domain.Task, error) {
	if segmentID < 1 || modelID < 0 || (modelID == accountOpenAICompatibleImageModelID && kind != "image") || !validTaskKind(kind) || kind == "export" {
		return domain.Task{}, taskCreationError("任务参数无效")
	}
	if api.deps.Queue == nil {
		return domain.Task{}, taskCreationError("任务队列未配置，无法提交生成任务")
	}
	segment, err := shuihuostore.NewSegments(api.deps.DB).GetSegment(ctx, user.ID, segmentID)
	if errors.Is(err, sql.ErrNoRows) || segment.ProjectID != project.ID {
		return domain.Task{}, taskCreationError("分段不存在")
	}
	if err != nil {
		return domain.Task{}, taskCreationError("读取分段失败")
	}
	if !segment.Confirmed {
		return domain.Task{}, taskCreationError("请先确认分段")
	}
	var config domain.UserProductionConfig
	if kind == "image" || kind == "video" {
		config, err = shuihuostore.NewProductionConfigs(api.deps.DB).Get(ctx, user.ID)
		if err != nil {
			return domain.Task{}, taskCreationError("读取引擎设置失败")
		}
	}
	var model models.Definition
	var accountImageConfig store.ImageAPIConfig
	accountImageModel := modelID == accountOpenAICompatibleImageModelID
	if accountImageModel {
		var configured bool
		accountImageConfig, configured, err = api.accountOpenAICompatibleImageConfig(ctx, user.ID)
		if err != nil {
			return domain.Task{}, taskCreationError("读取账号图片配置失败")
		}
		if !configured {
			return domain.Task{}, taskCreationError("请先在设置中完成 OpenAI 兼容生图配置")
		}
		model = models.Definition{Name: accountImageConfig.Model, Kind: models.KindImage, AdapterKind: models.AdapterAccountOpenAICompatibleImage}
	} else {
		model, err = shuihuostore.NewModels(api.deps.DB).GetEnabled(ctx, modelID)
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Task{}, taskCreationError("所选模型未启用或不存在")
		}
		if err != nil {
			return domain.Task{}, taskCreationError("读取模型失败")
		}
		if !taskMatchesModel(kind, model.Kind) {
			return domain.Task{}, taskCreationError("模型类型与任务不匹配")
		}
		if !model.AvailableTo(shuihuoModelRole(user), false) {
			return domain.Task{}, taskCreationError("该模型仅限所有者使用")
		}
		if !model.ProviderConfigured() {
			return domain.Task{}, taskCreationError("所选模型尚未完成运行配置，请联系管理员配置凭据引用和提供方参数")
		}
		if kind == "video" && config.VideoGenerationMode == domain.VideoGenerationModeText && model.RequiresVideoImage() {
			return domain.Task{}, taskCreationError("所选视频模型仅支持图生视频，请在引擎设置中切换图生视频")
		}
		if model.AdapterKind == models.AdapterYDVideo {
			configured, configErr := api.ydVideoConfigured(ctx, user.ID)
			if configErr != nil {
				return domain.Task{}, taskCreationError("读取账号视频配置失败")
			}
			if !configured {
				return domain.Task{}, taskCreationError("请先在工作台设置中配置中转亚迪 API Key")
			}
		}
	}
	prompt := segment.ImagePrompt
	if kind == "video" {
		prompt = segment.VideoPrompt
	}
	if kind == "audio" {
		prompt = segment.SubtitleText
	}
	if strings.TrimSpace(prompt) == "" {
		return domain.Task{}, taskCreationError("请先保存对应提示词")
	}
	inputSnapshot := map[string]any{"prompt": prompt, "segmentId": segment.ID, "model": model.Name}
	if kind == "image" {
		assets := shuihuostore.NewAssets(api.deps.DB)
		inputSnapshot["aspectRatio"] = config.ImageAspectRatio
		inputSnapshot["resolution"] = config.ImageResolution
		prompt = composeConfiguredPrompt(config.ImagePrefix, prompt, config.ImageSuffix)
		inputSnapshot["prompt"] = prompt
		inputSnapshot["basePrompt"] = segment.ImagePrompt
		referenceObjectKeys, referencesErr := assets.ListReferenceObjectKeysBySegment(ctx, user.ID, segment.ID)
		if referencesErr != nil {
			return domain.Task{}, taskCreationError("读取分镜预设参考图失败")
		}
		if len(referenceObjectKeys) > 0 {
			if !model.SupportsReferenceImages() {
				return domain.Task{}, taskCreationError("所选图片模型不支持分镜预设参考图，请在模型配置中使用参考图占位符或改选支持参考图的模型")
			}
			inputSnapshot["referenceObjectKeys"] = referenceObjectKeys
		}
	}
	if kind == "video" {
		assets := shuihuostore.NewAssets(api.deps.DB)
		inputSnapshot["aspectRatio"] = config.VideoAspectRatio
		inputSnapshot["resolution"] = config.VideoResolution
		mode, modeErr := domain.NormalizeVideoGenerationMode(config.VideoGenerationMode)
		if modeErr != nil {
			return domain.Task{}, taskCreationError("视频生成模式无效")
		}
		inputSnapshot["videoGenerationMode"] = mode
		if mode == domain.VideoGenerationModeText {
			if model.RequiresVideoImage() {
				return domain.Task{}, taskCreationError("所选视频模型仅支持图生视频，请在引擎设置中切换图生视频")
			}
			boundAssets, assetsErr := assets.ListBySegment(ctx, user.ID, segment.ID)
			if assetsErr != nil {
				return domain.Task{}, taskCreationError("读取分镜预设失败")
			}
			prompt = composeTextToVideoPrompt(config.VideoPrefix, boundAssets, prompt, config.VideoSuffix)
			inputSnapshot["prompt"] = prompt
			inputSnapshot["basePrompt"] = segment.VideoPrompt
		} else {
			prompt = composeConfiguredPrompt(config.VideoPrefix, prompt, config.VideoSuffix)
			inputSnapshot["prompt"] = prompt
			inputSnapshot["basePrompt"] = segment.VideoPrompt
			sourceObjectKey, referenceObjectKeys, sourceErr := api.imageToVideoSnapshot(ctx, user.ID, project.ID, segment.ID, assets)
			if sourceErr != nil {
				return domain.Task{}, taskCreationError(sourceErr.Error())
			}
			if sourceObjectKey == "" {
				return domain.Task{}, taskCreationError("图生视频需要当前分镜的预设图或主图片")
			}
			inputSnapshot["sourceImageObjectKey"] = sourceObjectKey
			if len(referenceObjectKeys) > 0 {
				inputSnapshot["videoReferenceObjectKeys"] = referenceObjectKeys
			}
		}
		if model.AdapterKind == models.AdapterYDVideo {
			if config.VideoAspectRatio != "9:16" && config.VideoAspectRatio != "16:9" {
				return domain.Task{}, taskCreationError("YD 视频比例仅支持 9:16 或 16:9")
			}
			inputSnapshot["resolution"] = "720p"
		}
	}
	if accountImageModel {
		inputSnapshot["provider"] = models.AdapterAccountOpenAICompatibleImage
	}
	if kind == "audio" {
		settings, settingsErr := normalizedAudioTaskSettings(audioSettings)
		if settingsErr != nil {
			return domain.Task{}, taskCreationError("配音设置参数无效")
		}
		inputSnapshot["voice"] = settings.Voice
		inputSnapshot["speechRate"] = settings.SpeechRate
		inputSnapshot["pitch"] = settings.Pitch
	}
	input, _ := json.Marshal(inputSnapshot)
	taskDefinition := domain.Task{SegmentID: &segment.ID, Kind: kind, Status: domain.TaskDraft, Provider: model.AdapterKind, Input: string(input)}
	if !accountImageModel {
		modelVersionID := model.VersionID
		taskDefinition.ModelID = &modelID
		taskDefinition.ModelVersionID = &modelVersionID
	}
	task, err := shuihuostore.NewTasks(api.deps.DB).Create(ctx, user.ID, project.ID, taskDefinition)
	if err != nil {
		if errors.Is(err, shuihuostore.ErrTaskSegmentUnavailable) {
			return domain.Task{}, taskCreationError("分镜已变更，请刷新后重试")
		}
		return domain.Task{}, taskCreationError("创建任务失败")
	}
	tasks := shuihuostore.NewTasks(api.deps.DB)
	if err := tasks.Transition(ctx, user.ID, task.ID, domain.TaskDraft, domain.TaskQueued, "已进入 Redis 队列"); err != nil {
		_ = tasks.Delete(ctx, user.ID, task.ID)
		if errors.Is(err, shuihuostore.ErrTaskSegmentUnavailable) {
			return domain.Task{}, taskCreationError("分镜已变更，请刷新后重试")
		}
		return domain.Task{}, taskCreationErrorWithSingleMessage("更新任务状态失败", fmt.Sprintf("更新任务状态失败: %v", err))
	}
	if err := api.deps.Queue.Enqueue(ctx, task.ID); err != nil {
		_ = tasks.Transition(ctx, user.ID, task.ID, domain.TaskQueued, domain.TaskCancelled, "任务队列提交失败")
		return domain.Task{}, taskCreationError("任务队列不可用，未提交生成任务")
	}
	task.Status = domain.TaskQueued
	return task, nil
}

func (api *API) ydVideoConfigured(ctx context.Context, userID int64) (bool, error) {
	if api.deps.VideoConfigs == nil || api.deps.CredentialCipher == nil {
		return false, nil
	}
	config, err := api.deps.VideoConfigs.Get(ctx, userID)
	if err != nil {
		return false, err
	}
	return config.Configured(), nil
}

func normalizedYDVideoTaskSettings(input *shuihuoVideoTaskSettings) (string, error) {
	aspectRatio := "9:16"
	if input != nil && strings.TrimSpace(input.AspectRatio) != "" {
		aspectRatio = strings.TrimSpace(input.AspectRatio)
	}
	if aspectRatio != "9:16" && aspectRatio != "16:9" {
		return "", errors.New("invalid YD aspect ratio")
	}
	return aspectRatio, nil
}

func composeConfiguredPrompt(parts ...string) string {
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			result = append(result, part)
		}
	}
	return strings.Join(result, "\n\n")
}

func composeTextToVideoPrompt(prefix string, assets []domain.Asset, videoPrompt, suffix string) string {
	parts := []string{prefix}
	for _, category := range []string{"character", "scene", "prop"} {
		for _, asset := range assets {
			if asset.Category == category && strings.TrimSpace(asset.Prompt) != "" {
				parts = append(parts, asset.Prompt)
			}
		}
	}
	parts = append(parts, videoPrompt, suffix)
	return composeConfiguredPrompt(parts...)
}

// imageToVideoSnapshot freezes only the current segment's visual assets. The
// scene is the preferred main frame; a generated storyboard image is the
// fallback, then the first available bound asset image. Reference images are
// capped at three because the strictest supported adapter accepts three.
func (api *API) imageToVideoSnapshot(ctx context.Context, ownerID, projectID, segmentID int64, assets *shuihuostore.Assets) (string, []string, error) {
	visualKeys, err := assets.ListReferenceObjectKeysBySegment(ctx, ownerID, segmentID)
	if err != nil {
		return "", nil, fmt.Errorf("读取分镜视频预设图片失败")
	}
	sceneObjectKey, err := assets.SceneObjectKeyBySegment(ctx, ownerID, segmentID)
	if err != nil {
		return "", nil, fmt.Errorf("读取场景预设图片失败")
	}
	primaryImage, mediaErr := shuihuostore.NewMedia(api.deps.DB).PrimaryImage(ctx, projectID, segmentID)
	if mediaErr != nil && !errors.Is(mediaErr, sql.ErrNoRows) {
		return "", nil, fmt.Errorf("读取分镜画面图片失败")
	}

	// A stale media row must not become a signed but unusable YD input URL.
	// Keep the intended priority while falling back to a surviving bound asset.
	sourceObjectKey := api.firstAvailableVideoImageObject(ctx, append([]string{sceneObjectKey, primaryImage.ObjectKey}, visualKeys...)...)
	refs := make([]string, 0, 3)
	for _, key := range visualKeys {
		if key == "" || key == sourceObjectKey || !api.videoImageObjectAvailable(ctx, key) {
			continue
		}
		refs = append(refs, key)
		if len(refs) == 3 {
			break
		}
	}
	return sourceObjectKey, refs, nil
}

func (api *API) firstAvailableVideoImageObject(ctx context.Context, keys ...string) string {
	seen := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		if api.videoImageObjectAvailable(ctx, key) {
			return key
		}
	}
	return ""
}

func (api *API) videoImageObjectAvailable(ctx context.Context, key string) bool {
	if api.deps.Objects == nil {
		return true
	}
	body, _, err := api.deps.Objects.Get(ctx, key)
	if err != nil {
		return false
	}
	return body.Close() == nil
}

func (api *API) accountOpenAICompatibleImageConfig(ctx context.Context, userID int64) (store.ImageAPIConfig, bool, error) {
	if api.deps.ImageConfigs == nil {
		return store.ImageAPIConfig{}, false, nil
	}
	config, err := api.deps.ImageConfigs.Get(ctx, userID)
	if err != nil {
		return store.ImageAPIConfig{}, false, err
	}
	return config, config.Configured(), nil
}

func (api *API) accountOpenAICompatibleImageModel(ctx context.Context, userID int64) (models.PublicModel, bool, error) {
	config, configured, err := api.accountOpenAICompatibleImageConfig(ctx, userID)
	if err != nil || !configured {
		return models.PublicModel{}, false, err
	}
	return models.PublicModel{
		ID:          accountOpenAICompatibleImageModelID,
		ModelID:     "current-account-openai-compatible-image",
		Name:        accountOpenAICompatibleImageModelName(config.DisplayName),
		Kind:        models.KindImage,
		AdapterKind: models.AdapterAccountOpenAICompatibleImage,
	}, true, nil
}

func accountOpenAICompatibleImageModelName(displayName string) string {
	name := strings.TrimSpace(displayName)
	if name == "" {
		name = "OpenAI 兼容"
	}
	return "当前账号 " + name + " 生图"
}

func shuihuoModelRole(user store.User) string {
	if user.IsOwner {
		return "owner"
	}
	return "user"
}

func normalizedAudioTaskSettings(input *shuihuoAudioTaskSettings) (struct {
	Voice      string
	SpeechRate float64
	Pitch      float64
}, error) {
	settings := struct {
		Voice      string
		SpeechRate float64
		Pitch      float64
	}{SpeechRate: 1}
	if input == nil {
		return settings, nil
	}
	settings.Voice = strings.TrimSpace(input.Voice)
	if len(settings.Voice) > 255 {
		return settings, errors.New("voice is too long")
	}
	if input.SpeechRate != nil {
		settings.SpeechRate = *input.SpeechRate
	}
	if input.Pitch != nil {
		settings.Pitch = *input.Pitch
	}
	if settings.SpeechRate < 0.5 || settings.SpeechRate > 2 || settings.Pitch < -50 || settings.Pitch > 50 {
		return settings, errors.New("audio settings outside allowed range")
	}
	return settings, nil
}

func (api *API) handleCancelShuihuoTask(w http.ResponseWriter, r *http.Request) {
	taskID, ok := parseShuihuoResourceID(w, r, "taskId", "任务")
	if !ok {
		return
	}
	user, _ := currentUser(r)
	if err := shuihuostore.NewTasks(api.deps.DB).Cancel(r.Context(), user.ID, taskID); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "任务无法取消"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleRetryShuihuoTask(w http.ResponseWriter, r *http.Request) {
	taskID, ok := parseShuihuoResourceID(w, r, "taskId", "任务")
	if !ok {
		return
	}
	if api.deps.Queue == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "任务队列未配置，无法重试"})
		return
	}
	user, _ := currentUser(r)
	tasks := shuihuostore.NewTasks(api.deps.DB)
	task, err := tasks.Retry(r.Context(), user.ID, taskID)
	if err != nil {
		if errors.Is(err, shuihuostore.ErrTaskSegmentUnavailable) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "分镜已变更，请刷新后重试"})
			return
		}
		writeJSON(w, http.StatusConflict, map[string]string{"error": "只有失败或取消的任务可以重试"})
		return
	}
	if err := tasks.Transition(r.Context(), user.ID, task.ID, domain.TaskDraft, domain.TaskQueued, "已重新进入 Redis 队列"); err != nil {
		_ = tasks.Delete(r.Context(), user.ID, task.ID)
		if errors.Is(err, shuihuostore.ErrTaskSegmentUnavailable) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "分镜已变更，请刷新后重试"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新任务状态失败"})
		return
	}
	if err := api.deps.Queue.Enqueue(r.Context(), task.ID); err != nil {
		_ = tasks.Transition(r.Context(), user.ID, task.ID, domain.TaskQueued, domain.TaskCancelled, "任务队列提交失败")
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "任务队列不可用，未提交重试"})
		return
	}
	task.Status = domain.TaskQueued
	writeJSON(w, http.StatusCreated, domain.ToPublicTask(task))
}

func parseShuihuoResourceID(w http.ResponseWriter, r *http.Request, name, label string) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的" + label + " ID"})
		return 0, false
	}
	return id, true
}

func validTaskKind(kind string) bool {
	return kind == "image" || kind == "video" || kind == "audio" || kind == "export"
}
func taskMatchesModel(kind string, modelKind models.Kind) bool {
	return (kind == "image" && modelKind == models.KindImage) || (kind == "video" && modelKind == models.KindVideo) || (kind == "audio" && modelKind == models.KindAudio)
}
