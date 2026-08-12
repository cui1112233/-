package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/segmentation"
	shuihuostore "qiantie/backend/internal/shuihuo/store"

	"github.com/go-chi/chi/v5"
)

type segmentationRequest struct {
	Text            string                          `json:"text"`
	LinesPerSegment int                             `json:"linesPerSegment"`
	Candidates      []segmentation.CandidateSegment `json:"candidates"`
}

func (api *API) handleFixedSegmentation(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req segmentationRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if req.LinesPerSegment < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "每段行数必须大于 0"})
		return
	}
	text := req.Text
	if text == "" {
		text = project.SourceText
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": segmentation.StatusCandidate, "candidates": segmentation.FixedLineSegments(text, req.LinesPerSegment)})
}

func (api *API) handleImportSegmentation(w http.ResponseWriter, r *http.Request) {
	if _, ok := api.shuihuoProjectForRequest(w, r); !ok {
		return
	}
	var req segmentationRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": segmentation.StatusCandidate, "candidates": segmentation.ParseImported(req.Text)})
}

func (api *API) shuihuoProjectForRequest(w http.ResponseWriter, r *http.Request) (domain.Project, bool) {
	projectID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || projectID < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的项目 ID"})
		return domain.Project{}, false
	}
	user, _ := currentUser(r)
	project, err := shuihuostore.NewProjects(api.deps.DB).GetProject(r.Context(), user.ID, projectID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
		return domain.Project{}, false
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取项目失败"})
		return domain.Project{}, false
	}
	return project, true
}

func (api *API) handleSmartSegmentation(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusConflict, map[string]string{"error": "智能分段模型尚未由管理员配置"})
}

func (api *API) handleConfirmSegmentation(w http.ResponseWriter, r *http.Request) {
	projectID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || projectID < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的项目 ID"})
		return
	}
	var req segmentationRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if len(req.Candidates) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请至少确认一个分段"})
		return
	}
	segments := make([]domain.Segment, 0, len(req.Candidates))
	for _, candidate := range req.Candidates {
		segments = append(segments, domain.Segment{SourceText: candidate.Text})
	}
	user, _ := currentUser(r)
	if err := shuihuostore.NewSegments(api.deps.DB).ReplaceConfirmed(r.Context(), user.ID, projectID, segments); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "确认分段失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": segmentation.StatusConfirmed})
}
