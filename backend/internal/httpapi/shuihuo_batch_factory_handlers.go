package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

type batchFactoryVideoUnit struct {
	SourceText  string `json:"sourceText"`
	VideoPrompt string `json:"videoPrompt"`
	Duration    int    `json:"duration"`
	AspectRatio string `json:"aspectRatio"`
}

type batchFactoryVideoImportRequest struct {
	Name       string                  `json:"name"`
	SourceText string                  `json:"sourceText"`
	ModelID    int64                   `json:"modelId"`
	Videos     []batchFactoryVideoUnit `json:"videos"`
}

type batchFactoryVideoImportResult struct {
	Index     int                `json:"index"`
	SegmentID int64              `json:"segmentId,omitempty"`
	Task      *domain.PublicTask `json:"task,omitempty"`
	Error     string             `json:"error,omitempty"`
}

type batchFactoryProductionStatusRequest struct {
	ProjectIDs []int64 `json:"projectIds"`
}

type batchFactoryProductionMedia struct {
	ID           int64  `json:"id"`
	ProjectID    int64  `json:"projectId"`
	SegmentID    *int64 `json:"segmentId,omitempty"`
	TaskID       *int64 `json:"taskId,omitempty"`
	DurationMS   *int64 `json:"durationMs,omitempty"`
	DownloadPath string `json:"downloadPath"`
}

type batchFactoryProductionProject struct {
	ProjectID int64                         `json:"projectId"`
	Tasks     []domain.PublicTask           `json:"tasks"`
	Media     []batchFactoryProductionMedia `json:"media"`
}

// handleImportBatchFactoryVideos is deliberately a single server-side
// orchestration call. A staged batch-factory item becomes a persistent
// production project only when the user explicitly asks to generate video.
func (api *API) handleImportBatchFactoryVideos(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	if api.deps.Queue == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "任务队列未配置，无法生成视频"})
		return
	}
	var req batchFactoryVideoImportRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || req.ModelID < 1 || len(req.Videos) == 0 || len(req.Videos) > 200 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "批量工厂视频参数无效"})
		return
	}
	user, _ := currentUser(r)
	model, err := shuihuostore.NewModels(api.deps.DB).GetEnabled(r.Context(), req.ModelID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选视频模型未启用或不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取视频模型失败"})
		return
	}
	if model.Kind != models.KindVideo || !model.AvailableTo(shuihuoModelRole(user), false) || !model.ProviderConfigured() {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选视频模型当前不可用"})
		return
	}
	if model.RequiresImageInput() {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "该模型需要主图片。批量工厂直接生成当前请选择文生视频模型；图生视频可转为生产项目后绑定图片再生成。"})
		return
	}
	maxVideoDuration := model.MaxVideoDuration()
	if maxVideoDuration < 1 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "所选视频模型未配置单次最大生成时长，请管理员先在模型中心补充该能力。"})
		return
	}
	for index, video := range req.Videos {
		if strings.TrimSpace(video.VideoPrompt) == "" || strings.TrimSpace(video.SourceText) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "第 " + strconv.Itoa(index+1) + " 个 VIDEO 缺少内容或提示词"})
			return
		}
		if _, err := normalizedVideoTaskSettings(&shuihuoVideoTaskSettings{Duration: video.Duration, AspectRatio: video.AspectRatio}); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "第 " + strconv.Itoa(index+1) + " 个 VIDEO 的时长或画幅无效"})
			return
		}
		if video.Duration > maxVideoDuration {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "第 " + strconv.Itoa(index+1) + " 个 VIDEO 为 " + strconv.Itoa(video.Duration) + " 秒，超过所选模型单次最大 " + strconv.Itoa(maxVideoDuration) + " 秒，请重新导演拆分。"})
			return
		}
	}

	project, err := shuihuostore.NewProjects(api.deps.DB).Create(r.Context(), user.ID, domain.Project{
		Name: name, SourceText: req.SourceText, SegmentationStatus: "confirmed",
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建批量工厂生产项目失败"})
		return
	}

	segmentsRepo := shuihuostore.NewSegments(api.deps.DB)
	results := make([]batchFactoryVideoImportResult, 0, len(req.Videos))
	allQueued := true
	for index, video := range req.Videos {
		segment, createErr := segmentsRepo.Create(r.Context(), user.ID, project.ID, domain.Segment{
			SourceText: video.SourceText, OrderIndex: index + 1, Confirmed: true, ManuallyEdited: true,
			VideoPrompt: video.VideoPrompt, VideoPromptLocked: true,
		})
		result := batchFactoryVideoImportResult{Index: index + 1}
		if createErr != nil {
			allQueued = false
			result.Error = "创建 VIDEO 分段失败"
			results = append(results, result)
			continue
		}
		result.SegmentID = segment.ID
		settings := &shuihuoVideoTaskSettings{Duration: video.Duration, AspectRatio: video.AspectRatio}
		task, taskErr := api.createShuihuoTask(r.Context(), user, project, segment.ID, req.ModelID, "video", nil, settings)
		if taskErr != nil {
			allQueued = false
			result.Error = taskCreationErrorMessage(taskErr)
		} else {
			public := domain.ToPublicTask(task)
			result.Task = &public
		}
		results = append(results, result)
	}
	status := http.StatusCreated
	if !allQueued {
		status = http.StatusMultiStatus
	}
	writeJSON(w, status, map[string]any{
		"project": project,
		"model":   models.ToPublic(model),
		"results": results,
	})
}

// handleBatchFactoryProductionStatus returns the production state for many
// batch-factory projects in one request. Both repositories apply user ownership
// filters, and the response deliberately omits task input/output snapshots and
// object storage keys.
func (api *API) handleBatchFactoryProductionStatus(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	var req batchFactoryProductionStatusRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if len(req.ProjectIDs) == 0 || len(req.ProjectIDs) > 200 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "生产项目范围无效"})
		return
	}
	seen := make(map[int64]struct{}, len(req.ProjectIDs))
	projectIDs := make([]int64, 0, len(req.ProjectIDs))
	for _, projectID := range req.ProjectIDs {
		if projectID < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "生产项目ID无效"})
			return
		}
		if _, duplicate := seen[projectID]; duplicate {
			continue
		}
		seen[projectID] = struct{}{}
		projectIDs = append(projectIDs, projectID)
	}
	user, _ := currentUser(r)
	tasks, err := shuihuostore.NewTasks(api.deps.DB).ListByProjects(r.Context(), user.ID, projectIDs)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取批量视频任务状态失败"})
		return
	}
	media, err := shuihuostore.NewMedia(api.deps.DB).ListByProjects(r.Context(), user.ID, projectIDs)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取批量视频成品失败"})
		return
	}

	byProject := make(map[int64]*batchFactoryProductionProject)
	ensureProject := func(projectID int64) *batchFactoryProductionProject {
		if current := byProject[projectID]; current != nil {
			return current
		}
		current := &batchFactoryProductionProject{
			ProjectID: projectID,
			Tasks:     make([]domain.PublicTask, 0),
			Media:     make([]batchFactoryProductionMedia, 0),
		}
		byProject[projectID] = current
		return current
	}
	for _, task := range tasks {
		if task.Kind != "video" {
			continue
		}
		project := ensureProject(task.ProjectID)
		project.Tasks = append(project.Tasks, domain.ToPublicTask(task))
	}
	for _, item := range media {
		if item.Kind != "video" {
			continue
		}
		project := ensureProject(item.ProjectID)
		project.Media = append(project.Media, batchFactoryProductionMedia{
			ID:           item.ID,
			ProjectID:    item.ProjectID,
			SegmentID:    item.SegmentID,
			TaskID:       item.TaskID,
			DurationMS:   item.DurationMS,
			DownloadPath: "/api/shuihuo-production/media/" + strconv.FormatInt(item.ID, 10) + "/download",
		})
	}
	projects := make([]batchFactoryProductionProject, 0, len(projectIDs))
	for _, projectID := range projectIDs {
		if project := byProject[projectID]; project != nil {
			projects = append(projects, *project)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects})
}
