package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
	"qiantie/backend/internal/store"
)

type shuihuoTaskRequest struct {
	SegmentID int64  `json:"segmentId"`
	Kind      string `json:"kind"`
	ModelID   int64  `json:"modelId"`
}

type shuihuoBatchTaskRequest struct {
	SegmentIDs []int64 `json:"segmentIds"`
	Kind       string  `json:"kind"`
	ModelID    int64   `json:"modelId"`
}

type shuihuoBatchTaskResult struct {
	SegmentID int64        `json:"segmentId"`
	Task      *domain.Task `json:"task,omitempty"`
	Error     string       `json:"error,omitempty"`
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
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
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
	task, err := api.createShuihuoTask(r.Context(), user, project, req.SegmentID, req.ModelID, req.Kind)
	if err != nil {
		writeJSON(w, taskCreationStatus(err), map[string]string{"error": singleTaskCreationErrorMessage(err)})
		return
	}
	writeJSON(w, http.StatusCreated, task)
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
		task, err := api.createShuihuoTask(r.Context(), user, project, segmentID, req.ModelID, req.Kind)
		result := shuihuoBatchTaskResult{SegmentID: segmentID}
		if err != nil {
			allSucceeded = false
			result.Error = taskCreationErrorMessage(err)
		} else {
			result.Task = &task
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
	case "任务参数无效", "模型类型与任务不匹配":
		return http.StatusBadRequest
	case "分段不存在":
		return http.StatusNotFound
	case "请先确认分段", "所选模型未启用或不存在", "所选模型尚未完成运行配置，请联系管理员配置凭据引用和提供方参数", "请先保存对应提示词":
		return http.StatusConflict
	case "该模型仅限所有者使用":
		return http.StatusForbidden
	case "任务队列未配置，无法提交生成任务", "任务队列不可用，未提交生成任务":
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

func (api *API) createShuihuoTask(ctx context.Context, user store.User, project domain.Project, segmentID, modelID int64, kind string) (domain.Task, error) {
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
	if !model.AvailableTo(user.IsOwner) {
		return domain.Task{}, taskCreationError("该模型仅限所有者使用")
	}
	if !model.ProviderConfigured() {
		return domain.Task{}, taskCreationError("所选模型尚未完成运行配置，请联系管理员配置凭据引用和提供方参数")
	}
	prompt := segment.ImagePrompt
	if kind == "video" || kind == "audio" {
		prompt = segment.VideoPrompt
	}
	if kind == "audio" && strings.TrimSpace(prompt) == "" {
		prompt = segment.SubtitleText
	}
	if strings.TrimSpace(prompt) == "" {
		return domain.Task{}, taskCreationError("请先保存对应提示词")
	}
	input, _ := json.Marshal(map[string]any{"prompt": prompt, "segmentId": segment.ID, "model": model.Name})
	modelVersionID := model.VersionID
	task, err := shuihuostore.NewTasks(api.deps.DB).Create(ctx, user.ID, project.ID, domain.Task{SegmentID: &segment.ID, Kind: kind, Status: domain.TaskDraft, Provider: model.AdapterKind, ModelID: &modelID, ModelVersionID: &modelVersionID, Input: string(input)})
	if err != nil {
		return domain.Task{}, taskCreationError("创建任务失败")
	}
	tasks := shuihuostore.NewTasks(api.deps.DB)
	if err := api.deps.Queue.Enqueue(ctx, task.ID); err != nil {
		_ = tasks.Delete(ctx, user.ID, task.ID)
		return domain.Task{}, taskCreationError("任务队列不可用，未提交生成任务")
	}
	if err := tasks.Transition(ctx, user.ID, task.ID, domain.TaskDraft, domain.TaskQueued, "已进入 Redis 队列"); err != nil {
		return domain.Task{}, taskCreationErrorWithSingleMessage("更新任务状态失败", fmt.Sprintf("更新任务状态失败: %v", err))
	}
	task.Status = domain.TaskQueued
	return task, nil
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
		writeJSON(w, http.StatusConflict, map[string]string{"error": "只有失败或取消的任务可以重试"})
		return
	}
	if err := api.deps.Queue.Enqueue(r.Context(), task.ID); err != nil {
		_ = tasks.Delete(r.Context(), user.ID, task.ID)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "任务队列不可用，未提交重试"})
		return
	}
	if err := tasks.Transition(r.Context(), user.ID, task.ID, domain.TaskDraft, domain.TaskQueued, "已重新进入 Redis 队列"); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新任务状态失败"})
		return
	}
	task.Status = domain.TaskQueued
	writeJSON(w, http.StatusCreated, task)
}

func validTaskKind(kind string) bool {
	return kind == "image" || kind == "video" || kind == "audio" || kind == "export"
}
func taskMatchesModel(kind string, modelKind models.Kind) bool {
	return (kind == "image" && modelKind == models.KindImage) || (kind == "video" && modelKind == models.KindVideo) || (kind == "audio" && modelKind == models.KindAudio)
}
