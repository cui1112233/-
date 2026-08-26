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
}

// shuihuoAudioTaskSettings contains only user-visible synthesis choices. The
// model's credential, endpoint and request template remain server-side.
type shuihuoAudioTaskSettings struct {
	Voice      string   `json:"voice"`
	SpeechRate *float64 `json:"speechRate,omitempty"`
	Pitch      *float64 `json:"pitch,omitempty"`
}

// shuihuoVideoTaskSettings contains the provider-neutral video controls that
// generic request templates may consume through their declared placeholders.
type shuihuoVideoTaskSettings struct {
	Duration    string `json:"duration,omitempty"`
	AspectRatio string `json:"aspectRatio,omitempty"`
	Resolution  string `json:"resolution,omitempty"`
}

type shuihuoBatchTaskResult struct {
	SegmentID int64              `json:"segmentId"`
	Task      *domain.PublicTask `json:"task,omitempty"`
	Error     string             `json:"error,omitempty"`
}

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
		if item.PubliclySelectable() {
			public = append(public, models.ToPublic(item))
		}
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
	results := make([]shuihuoBatchTaskResult, 0, len(req.SegmentIDs))
	allSucceeded := true
	for _, segmentID := range req.SegmentIDs {
		var audioSettings *shuihuoAudioTaskSettings
		if req.Kind == "audio" {
			settings := req.AudioSettingsBySegment[segmentID]
			audioSettings = &settings
		}
		task, err := api.createShuihuoTask(r.Context(), user, project, segmentID, req.ModelID, req.Kind, audioSettings, req.VideoSettings)
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
	if len(req.SegmentIDs) == 0 || len(req.SegmentIDs) > 50 || req.ModelID < 1 || !validTaskKind(req.Kind) || req.Kind == "export" {
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

func taskCreationStatus(err error) int {
	switch taskCreationErrorMessage(err) {
	case "任务参数无效", "模型类型与任务不匹配", "视频设置参数无效", "配音设置参数无效":
		return http.StatusBadRequest
	case "分段不存在":
		return http.StatusNotFound
	case "请先确认分段", "所选模型未启用或不存在", "所选模型尚未完成运行配置，请联系管理员配置凭据引用和提供方参数", "请先保存对应提示词":
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
	if segmentID < 1 || modelID < 1 || !validTaskKind(kind) || kind == "export" {
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
	model, err := shuihuostore.NewModels(api.deps.DB).GetEnabled(ctx, modelID)
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
	if kind == "audio" {
		settings, settingsErr := normalizedAudioTaskSettings(audioSettings)
		if settingsErr != nil {
			return domain.Task{}, taskCreationError("配音设置参数无效")
		}
		inputSnapshot["voice"] = settings.Voice
		inputSnapshot["speechRate"] = settings.SpeechRate
		inputSnapshot["pitch"] = settings.Pitch
	}
	if kind == "video" {
		settings, settingsErr := normalizedVideoTaskSettings(videoSettings)
		if settingsErr != nil {
			return domain.Task{}, taskCreationError("视频设置参数无效")
		}
		if settings.Duration != "" {
			inputSnapshot["duration"] = settings.Duration
		}
		if settings.AspectRatio != "" {
			inputSnapshot["aspectRatio"] = settings.AspectRatio
		}
		if settings.Resolution != "" {
			inputSnapshot["resolution"] = settings.Resolution
		}
	}
	input, _ := json.Marshal(inputSnapshot)
	modelVersionID := model.VersionID
	task, err := shuihuostore.NewTasks(api.deps.DB).Create(ctx, user.ID, project.ID, domain.Task{SegmentID: &segment.ID, Kind: kind, Status: domain.TaskDraft, Provider: model.AdapterKind, ModelID: &modelID, ModelVersionID: &modelVersionID, Input: string(input)})
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

func normalizedVideoTaskSettings(input *shuihuoVideoTaskSettings) (struct {
	Duration    string
	AspectRatio string
	Resolution  string
}, error) {
	settings := struct {
		Duration    string
		AspectRatio string
		Resolution  string
	}{}
	if input == nil {
		return settings, nil
	}
	settings.Duration = strings.TrimSpace(input.Duration)
	settings.AspectRatio = strings.TrimSpace(input.AspectRatio)
	settings.Resolution = strings.TrimSpace(input.Resolution)
	if len(settings.Duration) > 64 || len(settings.AspectRatio) > 64 || len(settings.Resolution) > 64 {
		return settings, errors.New("video setting is too long")
	}
	if strings.ContainsAny(settings.Duration+settings.AspectRatio+settings.Resolution, "\r\n\x00") {
		return settings, errors.New("video setting contains invalid control characters")
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
