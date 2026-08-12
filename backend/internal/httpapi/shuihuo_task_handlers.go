package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

type shuihuoTaskRequest struct {
	SegmentID int64  `json:"segmentId"`
	Kind      string `json:"kind"`
	ModelID   int64  `json:"modelId"`
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
	if req.SegmentID < 1 || req.ModelID < 1 || !validTaskKind(req.Kind) || req.Kind == "export" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "任务参数无效"})
		return
	}
	if api.deps.Queue == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "任务队列未配置，无法提交生成任务"})
		return
	}
	user, _ := currentUser(r)
	segment, err := shuihuostore.NewSegments(api.deps.DB).GetSegment(r.Context(), user.ID, req.SegmentID)
	if errors.Is(err, sql.ErrNoRows) || segment.ProjectID != project.ID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "分段不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取分段失败"})
		return
	}
	if !segment.Confirmed {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "请先确认分段"})
		return
	}
	model, err := shuihuostore.NewModels(api.deps.DB).GetEnabled(r.Context(), req.ModelID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选模型未启用或不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取模型失败"})
		return
	}
	if !taskMatchesModel(req.Kind, model.Kind) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "模型类型与任务不匹配"})
		return
	}
	if !model.AvailableTo(user.IsOwner) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "该模型仅限所有者使用"})
		return
	}
	if !model.ProviderConfigured() {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选模型尚未完成运行配置，请联系管理员配置凭据引用和提供方参数"})
		return
	}
	prompt := segment.ImagePrompt
	if req.Kind == "video" || req.Kind == "audio" {
		prompt = segment.VideoPrompt
	}
	if req.Kind == "audio" && strings.TrimSpace(prompt) == "" {
		prompt = segment.SubtitleText
	}
	if strings.TrimSpace(prompt) == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "请先保存对应提示词"})
		return
	}
	input, _ := json.Marshal(map[string]any{"prompt": prompt, "segmentId": segment.ID, "model": model.Name})
	modelID, versionID := model.ID, model.VersionID
	task, err := shuihuostore.NewTasks(api.deps.DB).Create(r.Context(), user.ID, project.ID, domain.Task{SegmentID: &segment.ID, Kind: req.Kind, Status: domain.TaskDraft, Provider: model.AdapterKind, ModelID: &modelID, ModelVersionID: &versionID, Input: string(input)})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建任务失败"})
		return
	}
	tasks := shuihuostore.NewTasks(api.deps.DB)
	if err := api.deps.Queue.Enqueue(r.Context(), task.ID); err != nil {
		_ = tasks.Delete(r.Context(), user.ID, task.ID)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "任务队列不可用，未提交生成任务"})
		return
	}
	if err := tasks.Transition(r.Context(), user.ID, task.ID, domain.TaskDraft, domain.TaskQueued, "已进入 Redis 队列"); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("更新任务状态失败: %v", err)})
		return
	}
	task.Status = domain.TaskQueued
	writeJSON(w, http.StatusCreated, task)
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
